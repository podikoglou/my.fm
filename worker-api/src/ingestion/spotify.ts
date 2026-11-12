import { SpotifyApi } from "@spotify/web-api-ts-sdk";

import type { WorkerEnv } from "../alchemy.ts";

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

/** Spotify caps the page size at 50. */
export type RecentTracksLimit = 50;

export type SpotifyClient = {
  getRecentlyPlayedTracks(
    limit: RecentTracksLimit,
    options?: { type: "after"; timestamp: number },
  ): Promise<RecentlyPlayedPage>;
};

export type CreateSpotifyClient = (accessToken: string) => SpotifyClient;

/**
 * The message that the SDK's default response validator puts on an HTTP 429
 * error. The validator drops the response body and the headers.
 */
const QUOTA_ERROR_MESSAGE = "The app has exceeded its rate limits.";

export type SpotifyQuotaFailure = {
  /**
   * Seconds until Spotify accepts requests again. Null when Spotify sends no
   * usable `Retry-After` header.
   */
  retryAfterSeconds: number | null;
};

/**
 * A quota error (HTTP 429) that keeps the retry window. The SDK throws a plain
 * `Error` and drops the headers, so this module rethrows its own error.
 */
export class SpotifyQuotaExceededError extends Error {
  readonly retryAfterSeconds: number | null;

  constructor(retryAfterSeconds: number | null) {
    super(QUOTA_ERROR_MESSAGE);
    this.name = "SpotifyQuotaExceededError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

/**
 * True for the plain error that the SDK throws for an HTTP 429. The SDK drops
 * the status and the headers, so the message is the only signal that it keeps.
 */
function isSdkQuotaError(error: Error) {
  return error.message === QUOTA_ERROR_MESSAGE;
}

/**
 * Classify an error as a Spotify quota error (HTTP 429).
 *
 * Every account of one Spotify application shares one quota. A caller can use
 * this result to stop the whole run instead of trying the next account.
 *
 * The classifier accepts both the error that this module throws and the plain
 * error that the SDK throws.
 */
export function getSpotifyQuotaError(error: Error): SpotifyQuotaFailure | null {
  if (error instanceof SpotifyQuotaExceededError) {
    return { retryAfterSeconds: error.retryAfterSeconds };
  }

  if (isSdkQuotaError(error)) {
    return { retryAfterSeconds: null };
  }

  return null;
}

/**
 * Create a Spotify client for one user's access token. The token is refreshed
 * by Better Auth before it reaches this function.
 */
export function createSpotifyClient(env: WorkerEnv, accessToken: string): SpotifyClient {
  let quotaResponse = false;
  let quotaRetryAfterSeconds: number | null = null;

  const api = SpotifyApi.withAccessToken(
    env.SPOTIFY_CLIENT_ID,
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "",
    },
    {
      // The SDK validates the response after this callback, so read the status
      // and the retry window here. The thrown error carries neither.
      afterRequest: (_url, _options, response) => {
        quotaResponse = response.status === 429;
        quotaRetryAfterSeconds = quotaResponse
          ? parseRetryAfterSeconds(response.headers.get("retry-after"))
          : null;
      },
    },
  );

  return {
    async getRecentlyPlayedTracks(limit, options) {
      quotaResponse = false;
      quotaRetryAfterSeconds = null;

      try {
        return await api.player.getRecentlyPlayedTracks(limit, options);
      } catch (error) {
        // The status is the first signal. The message match is a fallback, in
        // case an error arrives without passing through `afterRequest`.
        const isQuota = quotaResponse || (error instanceof Error && isSdkQuotaError(error));

        if (isQuota) {
          throw new SpotifyQuotaExceededError(quotaRetryAfterSeconds);
        }

        throw error;
      }
    },
  };
}

/** Read a `Retry-After` header in seconds. Spotify sends an integer. */
function parseRetryAfterSeconds(header: string | null): number | null {
  const trimmed = header?.trim() ?? "";

  // Reject the HTTP-date form and every other shape. Only digits are useful.
  if (!/^\d+$/.test(trimmed)) {
    return null;
  }

  return Number(trimmed);
}
