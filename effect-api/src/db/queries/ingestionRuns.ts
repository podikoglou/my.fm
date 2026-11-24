import { Effect } from "effect";

import { Db } from "../service.ts";
import { ingestionRuns } from "../schema.ts";

/** Outcome of a scheduled ingestion run. */
export type IngestionStatus = "ok" | "partial" | "quota";

/** The row is a heartbeat, so it keeps one fixed key. */
const HEARTBEAT_ID = 1;

/**
 * Store the outcome and the time of the run that just finished.
 *
 * `blockedUntil` carries a Spotify block to the next run and clears on a run
 * that reaches Spotify.
 */
export const recordIngestionRun = Effect.fn("ingestionRuns.record")(function* (values: {
  readonly at: Date;
  readonly status: IngestionStatus;
  readonly blockedUntil?: Date | null;
}) {
  const db = yield* Db;

  const row = {
    id: HEARTBEAT_ID,
    lastRunAt: values.at,
    status: values.status,
    blockedUntil: values.blockedUntil ?? null,
  };

  yield* db.query((client) =>
    client
      .insert(ingestionRuns)
      .values(row)
      .onConflictDoUpdate({
        target: ingestionRuns.id,
        set: { lastRunAt: row.lastRunAt, status: row.status, blockedUntil: row.blockedUntil },
      }),
  );
});

/** Read the newest heartbeat, or undefined before the first run. */
export const findIngestionRun = Effect.fn("ingestionRuns.find")(function* () {
  const db = yield* Db;
  const rows = yield* db.query((client) => client.select().from(ingestionRuns).limit(1));

  return rows[0];
});
