import type { Database } from "../index.ts";

import { artists, type ArtistInsert } from "../schema.ts";

/**
 * Build an artist insert. The statement is returned so ingestion can batch it
 * with the rest of a play; awaiting it directly also works.
 */
export function insertArtist(db: Database, values: ArtistInsert) {
  return db.insert(artists).values(values).onConflictDoNothing().returning();
}
