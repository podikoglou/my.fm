import type { Database } from "../index.ts";

import { albumArtists, type Album, type Artist } from "../schema.ts";

export function insertAlbumArtist(
  db: Database,
  albumSpotifyUri: Album["spotifyUri"],
  artistSpotifyUri: Artist["spotifyUri"],
  position: number,
) {
  return db
    .insert(albumArtists)
    .values({ albumSpotifyUri, artistSpotifyUri, position })
    .onConflictDoNothing()
    .returning();
}
