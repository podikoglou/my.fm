import type { Database } from "../index.ts";

import { albums, type AlbumInsert } from "../schema.ts";

export function insertAlbum(db: Database, values: AlbumInsert) {
  return db.insert(albums).values(values).onConflictDoNothing().returning();
}
