import type { D1Database } from "@cloudflare/workers-types";
import { D1Client } from "@effect/sql-d1";
import type { Schema } from "effect";
import { Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import type { D1Client as D1ClientService } from "@effect/sql-d1/D1Client";
import type { SqlClient as SqlClientService } from "effect/sql/SqlClient";
import type * as SqlError from "effect/sql/SqlError";

import { mapSqlError, type DbError } from "./errors.ts";

export type DatabaseRequirements = SqlClientService | D1ClientService;

export const DbLive = (database: D1Database) => D1Client.layer({ db: database }).pipe(Layer.orDie);

export const asDbError = <A, R>(
  effect: Effect.Effect<A, Schema.SchemaError | SqlError.SqlError, R>,
): Effect.Effect<A, DbError, R> =>
  effect.pipe(
    Effect.catchTag("SchemaError", Effect.die),
    Effect.catchTag("SqlError", (error) => Effect.fail(mapSqlError(error))),
  );

export const ping = Effect.fn("Db.ping")(function* () {
  const sql = yield* SqlClient.SqlClient;
  const rows = yield* sql`SELECT 1 AS ok`.pipe(Effect.mapError(mapSqlError));

  return rows.length > 0;
});
