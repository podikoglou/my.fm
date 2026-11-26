import { Schema } from "effect";

import type { ProjectedArtist, ProjectedScrobble } from "../db/queries/scrobbles.ts";

export const RecentExtras = Schema.Array(
  Schema.Literals(["images", "spotifyUris", "albumArtists", "albumReleaseDate"]),
).annotate({
  description:
    "Select any combination of images (artwork URLs), spotifyUris (Spotify identifiers), albumArtists (album credits), and albumReleaseDate (the catalog release date at its recorded precision, or null if unknown). By default each play includes its ID, time, track, credited track artists and album name.",
});

export function presentRecentPlay(play: ProjectedScrobble, include: typeof RecentExtras.Type = []) {
  const images = include.includes("images");
  const uris = include.includes("spotifyUris");
  const artist = ({ name, spotifyUri }: ProjectedArtist) => ({ name, ...(uris && { spotifyUri }) });
  const { track, album } = play;

  return {
    id: play.id,
    scrobbleDate: play.scrobbleDate,
    track: {
      name: track.name,
      artists: track.artists.map(artist),
      ...(images && { imageUrl: track.imageUrl }),
      ...(uris && { spotifyUri: track.spotifyUri }),
    },
    album: {
      name: album.name,
      ...(include.includes("albumReleaseDate") && { releaseDate: album.releaseDate ?? null }),
      ...(include.includes("albumArtists") && { artists: album.artists.map(artist) }),
      ...(images && { imageUrl: album.imageUrl }),
      ...(uris && { spotifyUri: album.spotifyUri }),
    },
  };
}
