import { db } from "..";
import { albumArtists, type Album, type Artist } from "../schema";

export async function addAlbumArtist(
  albumSpotifyUri: Album["spotifyUri"],
  artistSpotifyUri: Artist["spotifyUri"],
  position: number,
) {
  return await db
    .insert(albumArtists)
    .values({ albumSpotifyUri, artistSpotifyUri, position })
    .onConflictDoNothing()
    .returning();
}
