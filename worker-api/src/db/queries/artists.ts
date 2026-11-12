import type { Database } from "../index.ts";

import { artists, type ArtistInsert } from "../schema.ts";

export function insertArtist(db: Database, values: ArtistInsert) {
  return db.insert(artists).values(values).onConflictDoNothing().returning();
}
