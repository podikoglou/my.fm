import { type MaxInt, SpotifyApi } from "@spotify/web-api-ts-sdk";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { AuthConfig } from "../auth/service.ts";
import {
  getSpotifyQuotaError,
  parseRetryAfter,
  SpotifyClientError,
  SpotifyQuotaExceededError,
} from "./errors.ts";

export interface SpotifyArtist {
  readonly uri: string;
  readonly name: string;
}

export interface SpotifyAlbum {
  readonly uri: string;
  readonly name: string;
  readonly release_date: string;
  readonly total_tracks: number;
  readonly album_type: string;
  readonly images: ReadonlyArray<{ readonly url: string }>;
  readonly artists: ReadonlyArray<SpotifyArtist>;
}

export interface SpotifyTrack {
  readonly uri: string;
  readonly name: string;
  readonly track_number: number;
  readonly explicit: boolean;
  readonly duration_ms: number;
  readonly artists: ReadonlyArray<SpotifyArtist>;
  readonly album: SpotifyAlbum;
}

export interface SpotifyPlay {
  readonly played_at: string;
  readonly track: SpotifyTrack;
}

export interface SpotifyPlayback {
  readonly progressMs: number;
}

export interface RecentlyPlayedOptions {
  readonly type: "after";
  readonly timestamp: number;
}

export interface SpotifyUserClient {
  readonly getRecentlyPlayedTracks: (
    limit: MaxInt<50>,
    options?: RecentlyPlayedOptions,
  ) => Effect.Effect<
    { readonly items: ReadonlyArray<SpotifyPlay> },
    SpotifyQuotaExceededError | SpotifyClientError
  >;
  readonly getCurrentlyPlaying: () => Effect.Effect<
    SpotifyPlayback | null,
    SpotifyQuotaExceededError
  >;
}

export interface SpotifyClientApi {
  readonly forAccessToken: (accessToken: string) => SpotifyUserClient;
}

const CurrentlyPlayingSchema = Schema.Struct({
  is_playing: Schema.Literal(true),
  currently_playing_type: Schema.Literal("track"),
  progress_ms: Schema.Finite,
});

const decodeCurrentlyPlaying = Schema.decodeUnknownOption(CurrentlyPlayingSchema);

/**
 * Wrap `fetch` so HTTP 429 responses throw `SpotifyQuotaExceededError` with
 * the parsed `Retry-After` header before `@spotify/web-api-ts-sdk` discards it.
 */
async function spotifyFetch(
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
): Promise<Response> {
  const response = await fetch(input, init);

  if (response.status === 429) {
    throw new SpotifyQuotaExceededError({
      retryAfterSeconds: parseRetryAfter(response.headers.get("retry-after")),
    });
  }

  return response;
}

function classifySpotifyError(cause: unknown): SpotifyQuotaExceededError | SpotifyClientError {
  if (cause instanceof SpotifyQuotaExceededError || cause instanceof Error) {
    const quota = getSpotifyQuotaError(cause);

    if (quota !== null) {
      return quota;
    }
  }

  return new SpotifyClientError({ cause });
}

function makeSdkUserClient(clientId: string, accessToken: string): SpotifyUserClient {
  // Better Auth refreshes the access token before this client is constructed.
  const sdk = SpotifyApi.withAccessToken(
    clientId,
    {
      access_token: accessToken,
      token_type: "Bearer",
      expires_in: 3600,
      refresh_token: "",
    },
    { fetch: spotifyFetch },
  );

  const getRecentlyPlayedTracks = Effect.fn("SpotifyClient.getRecentlyPlayedTracks")(function* (
    limit: MaxInt<50>,
    options?: RecentlyPlayedOptions,
  ) {
    return yield* Effect.tryPromise({
      try: () => sdk.player.getRecentlyPlayedTracks(limit, options),
      catch: classifySpotifyError,
    });
  });

  const getCurrentlyPlaying = Effect.fn("SpotifyClient.getCurrentlyPlaying")(function* () {
    const result = yield* Effect.tryPromise({
      try: () => sdk.player.getCurrentlyPlayingTrack(),
      catch: classifySpotifyError,
    }).pipe(Effect.catchTag("SpotifyClientError", () => Effect.succeed(null)));

    if (result === null || result === undefined) {
      return null;
    }

    const decoded = decodeCurrentlyPlaying(result);

    return Option.isSome(decoded) ? { progressMs: decoded.value.progress_ms } : null;
  });

  return { getRecentlyPlayedTracks, getCurrentlyPlaying };
}

export class SpotifyClient extends Context.Service<SpotifyClient, SpotifyClientApi>()(
  "@my.fm/api/spotify/SpotifyClient",
) {
  static readonly layer: Layer.Layer<SpotifyClient, never, AuthConfig> = Layer.effect(
    SpotifyClient,
    Effect.gen(function* () {
      const config = yield* AuthConfig;

      return SpotifyClient.of({
        forAccessToken: (accessToken) => makeSdkUserClient(config.spotifyClientId, accessToken),
      });
    }),
  );

  static readonly layerFromFactory = (
    forAccessToken: (accessToken: string) => SpotifyUserClient,
  ): Layer.Layer<SpotifyClient> => Layer.succeed(SpotifyClient, { forAccessToken });
}
