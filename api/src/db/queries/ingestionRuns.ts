import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { asDbError } from "../service.ts";
import { IngestionRunRow } from "../schema.ts";

/** Outcome of a scheduled ingestion run. */
export type IngestionStatus = "ok" | "partial" | "quota";

/** The row is a heartbeat, so it keeps one fixed key. */
const HEARTBEAT_ID = 1;

export const recordIngestionRun = Effect.fn("ingestionRuns.record")(function* (values: {
  readonly at: Date;
  readonly status: IngestionStatus;
  readonly blockedUntil?: Date | null;
}) {
  const sql = yield* SqlClient.SqlClient;
  const blockedUntil = values.blockedUntil ?? null;

  yield* asDbError(
    sql`
      INSERT INTO ingestion_runs (id, lastRunAt, status, blockedUntil)
      VALUES (
        ${HEARTBEAT_ID},
        ${values.at.getTime()},
        ${values.status},
        ${blockedUntil?.getTime() ?? null}
      )
      ON CONFLICT(id) DO UPDATE SET
        lastRunAt = excluded.lastRunAt,
        status = excluded.status,
        blockedUntil = excluded.blockedUntil
    `,
  );
});

export const findIngestionRun = Effect.fn("ingestionRuns.find")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Void,
    Result: IngestionRunRow,
    execute: () => sql`SELECT * FROM ingestion_runs LIMIT 1`,
  });

  const result = yield* asDbError(find(undefined));

  return Option.getOrUndefined(result);
});
