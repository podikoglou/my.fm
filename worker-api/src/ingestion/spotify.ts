import { SpotifyApi } from "@spotify/web-api-ts-sdk";

import type { WorkerEnv } from "../../alchemy.run.ts";

/**
 * The parts of a Spotify play that ingestion stores.
 *
 * These are structural subsets of the SDK's types, so a real SDK response is
 * assignable and tests can build small fixtures without the full payload.
 */
export type SpotifyArtist = {
  name: string;
  uri: string;
};

export type SpotifyImage = {
  url: string;
};

export type SpotifyAlbum = {
  uri: string;
  name: string;
  release_date: string;
  total_tracks: number;
  album_type: string;
  images: SpotifyImage[];
  artists: SpotifyArtist[];
};

export type SpotifyTrack = {
  uri: string;
  name: string;
  track_number: number;
  explicit: boolean;
  duration_ms: number;
  artists: SpotifyArtist[];
  album: SpotifyAlbum;
};

export type SpotifyPlay = {
  played_at: string;
  track: SpotifyTrack;
};

export type RecentlyPlayedPage = {
  items: SpotifyPlay[];
};

/** The two limits the Bun scheduler uses. */
export type RecentTracksLimit = 6 | 50;

export type SpotifyClient = {
  getRecentlyPlayedTracks(
    limit: RecentTracksLimit,
    options?: { type: "after"; timestamp: number },
  ): Promise<RecentlyPlayedPage>;
};

export type CreateSpotifyClient = (accessToken: string) => SpotifyClient;

/**
 * Create a Spotify client for one user's access token, as the Bun API does.
 * The token is refreshed by Better Auth before it reaches this function.
 */
export function createSpotifyClient(env: WorkerEnv, accessToken: string): SpotifyClient {
  const api = SpotifyApi.withAccessToken(env.SPOTIFY_CLIENT_ID, {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: 3600,
    refresh_token: "",
  });

  return {
    getRecentlyPlayedTracks: (limit, options) =>
      api.player.getRecentlyPlayedTracks(limit, options),
  };
}
