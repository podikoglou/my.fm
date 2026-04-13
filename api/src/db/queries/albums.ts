import { db } from "..";
import { albums, type AlbumInsert } from "../schema";
import { eq } from "drizzle-orm";

export async function createAlbum(values: AlbumInsert) {
  return await db.insert(albums).values(values).onConflictDoNothing().returning();
}

export async function findAlbumBySpotifyUri(spotifyUri: AlbumInsert["spotifyUri"]) {
  return await db.query.albums.findFirst({
    where: eq(albums.spotifyUri, spotifyUri),
  });
}
