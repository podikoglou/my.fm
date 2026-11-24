import type { D1Database } from "@cloudflare/workers-types";

import { drizzle } from "drizzle-orm/d1";
import { Context, Effect, Layer } from "effect";

import { classifyDbError, type DbError } from "./errors.ts";
import { relations } from "./schema.ts";

export function createDatabase(database: D1Database) {
  return drizzle(database, { relations });
}

export type DrizzleDatabase = ReturnType<typeof createDatabase>;

function toError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

function makeDbService(database: D1Database): Db["Service"] {
  const db = createDatabase(database);

  const query = <A>(fn: (client: DrizzleDatabase) => Promise<A>): Effect.Effect<A, DbError> =>
    Effect.tryPromise({
      try: () => fn(db),
      catch: (cause) => classifyDbError(toError(cause)),
    });

  const ping: Effect.Effect<boolean, DbError> = Effect.tryPromise({
    try: () => database.prepare("SELECT 1 AS ok").first<{ ok: number }>(),
    catch: (cause) => classifyDbError(toError(cause)),
  }).pipe(Effect.map((row) => row?.ok === 1));

  return Db.of({
    raw: database,
    drizzle: db,
    query,
    ping,
  });
}

export class Db extends Context.Service<
  Db,
  {
    readonly raw: D1Database;
    readonly drizzle: DrizzleDatabase;
    readonly query: <A>(fn: (client: DrizzleDatabase) => Promise<A>) => Effect.Effect<A, DbError>;
    readonly ping: Effect.Effect<boolean, DbError>;
  }
>()("@my.fm/api/db/Db") {
  static readonly layerFromBinding = (database: D1Database): Layer.Layer<Db> =>
    Layer.sync(Db, () => makeDbService(database));
}
