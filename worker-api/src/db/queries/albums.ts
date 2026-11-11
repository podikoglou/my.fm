import type { Database } from "../index.ts";

import { albums, type AlbumInsert } from "../schema.ts";

/**
 * Build an album insert. The statement is returned so ingestion can batch it
 * with the rest of a play; awaiting it directly also works.
 */
export function insertAlbum(db: Database, values: AlbumInsert) {
  return db.insert(albums).values(values).onConflictDoNothing().returning();
}
