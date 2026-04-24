import { db } from "..";
import { trackArtists, type Artist, type Track } from "../schema";

export async function addTrackArtist(
  trackSpotifyUri: Track["spotifyUri"],
  artistSpotifyUri: Artist["spotifyUri"],
  position: number,
) {
  return await db
    .insert(trackArtists)
    .values({ trackSpotifyUri, artistSpotifyUri, position })
    .onConflictDoNothing()
    .returning();
}
