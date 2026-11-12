import type { Database } from "../index.ts";

import { trackArtists, type Artist, type Track } from "../schema.ts";

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
