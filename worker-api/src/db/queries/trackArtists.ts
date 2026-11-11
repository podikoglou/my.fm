import type { Database } from "../index.ts";

import { trackArtists, type Artist, type Track } from "../schema.ts";

/**
 * Build a track-artist insert. The statement is returned so ingestion can
 * batch it with the rest of a play; awaiting it directly also works.
 */
export function insertTrackArtist(
  db: Database,
  trackSpotifyUri: Track["spotifyUri"],
  artistSpotifyUri: Artist["spotifyUri"],
  position: number,
) {
  return db
    .insert(trackArtists)
    .values({ trackSpotifyUri, artistSpotifyUri, position })
    .onConflictDoNothing()
    .returning();
}
