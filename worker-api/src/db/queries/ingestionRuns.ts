import type { IngestionStatus } from "../../ingestion/events.ts";
import type { Database } from "../index.ts";

import { ingestionRuns } from "../schema.ts";

/** The row is a heartbeat, so it keeps one fixed key. */
const HEARTBEAT_ID = 1;

/**
 * Store the outcome and the time of the run that just finished.
 *
 * `blockedUntil` carries a Spotify block to the next run and clears on a run
 * that reaches Spotify.
 */
export async function recordIngestionRun(
  db: Database,
  values: { at: Date; status: IngestionStatus; blockedUntil?: Date | null },
) {
  const row = {
    id: HEARTBEAT_ID,
    lastRunAt: values.at,
    status: values.status,
    blockedUntil: values.blockedUntil ?? null,
  };

  await db
    .insert(ingestionRuns)
    .values(row)
    .onConflictDoUpdate({
      target: ingestionRuns.id,
      set: { lastRunAt: row.lastRunAt, status: row.status, blockedUntil: row.blockedUntil },
    });
}

/** Read the newest heartbeat, or undefined before the first run. */
export async function findIngestionRun(db: Database) {
  const [run] = await db.select().from(ingestionRuns).limit(1);

  return run;
}
