import type { Database } from "../index.ts";

import { albumArtists, type Album, type Artist } from "../schema.ts";

/**
 * Build an album-artist insert. The statement is returned so ingestion can
 * batch it with the rest of a play; awaiting it directly also works.
 */
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
