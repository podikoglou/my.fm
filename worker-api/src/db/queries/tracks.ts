import type { Database } from "../index.ts";

import { tracks, type TrackInsert } from "../schema.ts";

/**
 * Build a track insert. The statement is returned so ingestion can batch it
 * with the rest of a play; awaiting it directly also works.
 */
export function insertTrack(db: Database, values: TrackInsert) {
  return db.insert(tracks).values(values).onConflictDoNothing().returning();
}
