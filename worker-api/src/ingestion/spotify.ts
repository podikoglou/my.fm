import { SpotifyApi } from "@spotify/web-api-ts-sdk";
import z from "zod";

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

/** The track that plays at the moment of the request. */
export type SpotifyPlayback = {
  /** How far into the track the playback is (ms). */
  progressMs: number;
};

/**
 * The part of a now-playing answer that ingestion uses. A paused track, a
 * podcast episode and an advert do not match, and neither does the empty
 * answer (HTTP 204) that Spotify sends when nothing plays.
 */
const playbackSchema = z.object({
  is_playing: z.literal(true),
  currently_playing_type: z.literal("track"),
  progress_ms: z.number(),
});

/** Spotify caps the page size at 50. */
export type RecentTracksLimit = 50;

export type SpotifyClient = {
  getRecentlyPlayedTracks(
    limit: RecentTracksLimit,
    options?: { type: "after"; timestamp: number },
  ): Promise<RecentlyPlayedPage>;
  /**
   * The track that plays right now. Null when no track plays, and when Spotify
   * refuses the token: a user who signed in before sign-in asked for the
   * `user-read-currently-playing` scope has not granted it.
   */
  getCurrentlyPlaying(): Promise<SpotifyPlayback | null>;
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
  let tokenRefused = false;

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
        tokenRefused = response.status === 401 || response.status === 403;
        quotaRetryAfterSeconds = quotaResponse
          ? parseRetryAfterSeconds(response.headers.get("retry-after"))
          : null;
      },
    },
  );

  /** Send one request and turn an HTTP 429 into an error that keeps the retry window. */
  async function send<Body>(request: () => Promise<Body>) {
    quotaResponse = false;
    quotaRetryAfterSeconds = null;
    tokenRefused = false;

    try {
      return await request();
    } catch (error) {
      // The status is the first signal. The message match is a fallback, in
      // case an error arrives without passing through `afterRequest`.
      const isQuota = quotaResponse || (error instanceof Error && isSdkQuotaError(error));

      if (isQuota) {
        throw new SpotifyQuotaExceededError(quotaRetryAfterSeconds);
      }

      throw error;
    }
  }

  return {
    async getRecentlyPlayedTracks(limit, options) {
      return await send(() => api.player.getRecentlyPlayedTracks(limit, options));
    },

    async getCurrentlyPlaying() {
      try {
        const body = await send(() => api.player.getCurrentlyPlayingTrack());
        const playback = playbackSchema.safeParse(body);

        return playback.success ? { progressMs: playback.data.progress_ms } : null;
      } catch (error) {
        if (tokenRefused) {
          return null;
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
