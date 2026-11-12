import type { Database } from "../index.ts";

import { tracks, type TrackInsert } from "../schema.ts";

export function insertTrack(db: Database, values: TrackInsert) {
  return db.insert(tracks).values(values).onConflictDoNothing().returning();
}
