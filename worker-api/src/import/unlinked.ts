import type { Scrobble } from "../db/schema.ts";

type StoredNames = Pick<
  Scrobble,
  "trackSpotifyUri" | "albumSpotifyUri" | "trackName" | "albumName" | "artistName" | "coverArtUrl"
>;

/**
 * The track of a play that links to no track row, from the names stored on
 * the play itself. An imported play has no track row when its metadata lookup
 * found no match.
 */
export function unlinkedTrack(play: StoredNames) {
  return {
    spotifyUri: play.trackSpotifyUri ?? undefined,
    name: play.trackName ?? "Unknown Track",
    imageUrl: play.coverArtUrl ?? "",
    artists: play.artistName ? [{ name: play.artistName, spotifyUri: undefined }] : [],
  };
}

/** The album of a play that links to no album row. */
export function unlinkedAlbum(play: StoredNames) {
  return {
    spotifyUri: play.albumSpotifyUri ?? undefined,
    name: play.albumName ?? "",
    imageUrl: play.coverArtUrl ?? "",
    artists: [],
  };
}
