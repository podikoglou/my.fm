import { env } from "cloudflare:workers";
import { Cause, Effect, Exit, Layer } from "effect";
import { http } from "msw";
import { describe, expect, test } from "vitest";

import { AuthConfig } from "../src/auth/service.ts";
import { getSpotifyQuotaError, SpotifyQuotaExceededError } from "../src/spotify/errors.ts";
import { SpotifyClient } from "../src/spotify/service.ts";
import { network } from "./network.ts";

const quotaBody = {
  error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" },
};

const sdkQuotaError = "The app has exceeded its rate limits.";

function makeTestSpotifyLayer() {
  return SpotifyClient.layer.pipe(
    Layer.provide(
      AuthConfig.layer({
        betterAuthSecret: env.BETTER_AUTH_SECRET,
        spotifyClientId: env.SPOTIFY_CLIENT_ID,
        spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET,
      }),
    ),
  );
}

function runWithSpotify<A, E>(
  effect: Effect.Effect<A, E, SpotifyClient>,
): Promise<Exit.Exit<A, E>> {
  return Effect.runPromiseExit(effect.pipe(Effect.provide(makeTestSpotifyLayer())));
}

describe("getSpotifyQuotaError", () => {
  test("reports the SDK quota error without a retry window", () => {
    const quota = getSpotifyQuotaError(new Error(sdkQuotaError));

    expect(quota).toBeInstanceOf(SpotifyQuotaExceededError);
    expect(quota?.retryAfterSeconds).toBeNull();
  });

  test("reports the retry window from a client quota error", () => {
    const quota = getSpotifyQuotaError(
      new SpotifyQuotaExceededError({ retryAfterSeconds: 66_362 }),
    );

    expect(quota).toBeInstanceOf(SpotifyQuotaExceededError);
    expect(quota?.retryAfterSeconds).toBe(66_362);
  });

  test("ignores other errors", () => {
    expect(getSpotifyQuotaError(new Error("Spotify unavailable"))).toBeNull();
    expect(getSpotifyQuotaError(new Error("Unrecognised response code: 500"))).toBeNull();
  });
});

describe("SpotifyClient.getRecentlyPlayedTracks", () => {
  test("turns a 429 into a quota error with the retry delay", async () => {
    network.use(
      http.get("https://api.spotify.com/v1/me/player/recently-played", async () =>
        Response.json(quotaBody, { status: 429, headers: { "retry-after": "66362" } }),
      ),
    );

    const exit = await runWithSpotify(
      Effect.gen(function* () {
        const spotify = yield* SpotifyClient;

        return yield* spotify.forAccessToken("token-1").getRecentlyPlayedTracks(50);
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);

      expect(error).toBeInstanceOf(SpotifyQuotaExceededError);

      if (error instanceof SpotifyQuotaExceededError) {
        expect(error.retryAfterSeconds).toBe(66_362);
      }
    }
  });

  test("keeps the quota classification when the response has no retry delay", async () => {
    network.use(
      http.get("https://api.spotify.com/v1/me/player/recently-played", async () =>
        Response.json(quotaBody, { status: 429 }),
      ),
    );

    const exit = await runWithSpotify(
      Effect.gen(function* () {
        const spotify = yield* SpotifyClient;

        return yield* spotify.forAccessToken("token-1").getRecentlyPlayedTracks(50);
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);

      expect(error).toBeInstanceOf(SpotifyQuotaExceededError);

      if (error instanceof SpotifyQuotaExceededError) {
        expect(error.retryAfterSeconds).toBeNull();
      }
    }
  });

  test("accepts only a whole, non-negative retry delay", async () => {
    const cases: { header: string; expected: number | null }[] = [
      { header: "0", expected: 0 },
      { header: "66362", expected: 66_362 },
      { header: "-5", expected: null },
      { header: "1.5", expected: null },
      { header: "abc", expected: null },
      { header: "", expected: null },
      { header: "Wed, 21 Oct 2026 07:28:00 GMT", expected: null },
    ];

    for (const { header, expected } of cases) {
      network.use(
        http.get("https://api.spotify.com/v1/me/player/recently-played", async () =>
          Response.json(quotaBody, { status: 429, headers: { "retry-after": header } }),
        ),
      );

      const exit = await runWithSpotify(
        Effect.gen(function* () {
          const spotify = yield* SpotifyClient;

          return yield* spotify.forAccessToken("token-1").getRecentlyPlayedTracks(50);
        }),
      );

      expect(Exit.isFailure(exit)).toBe(true);

      if (Exit.isFailure(exit)) {
        const error = Cause.squash(exit.cause);

        expect(error).toBeInstanceOf(SpotifyQuotaExceededError);

        if (error instanceof SpotifyQuotaExceededError) {
          expect(error.retryAfterSeconds).toBe(expected);
        }
      }
    }
  });
});

describe("SpotifyClient.getCurrentlyPlaying", () => {
  const url = "https://api.spotify.com/v1/me/player/currently-playing";
  const playing = { is_playing: true, currently_playing_type: "track", progress_ms: 42_000 };

  test("returns the position of the track that plays", async () => {
    network.use(http.get(url, async () => Response.json(playing)));

    const exit = await runWithSpotify(
      Effect.gen(function* () {
        const spotify = yield* SpotifyClient;

        return yield* spotify.forAccessToken("token-1").getCurrentlyPlaying();
      }),
    );

    expect(Exit.isSuccess(exit)).toBe(true);

    if (Exit.isSuccess(exit)) {
      expect(exit.value).toEqual({ progressMs: 42_000 });
    }
  });

  test("returns null when no track plays", async () => {
    const answers = [
      new Response(null, { status: 204 }),
      Response.json({ ...playing, is_playing: false }),
      Response.json({ ...playing, currently_playing_type: "episode" }),
    ];

    for (const answer of answers) {
      network.use(http.get(url, async () => answer));

      const exit = await runWithSpotify(
        Effect.gen(function* () {
          const spotify = yield* SpotifyClient;

          return yield* spotify.forAccessToken("token-1").getCurrentlyPlaying();
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);

      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBeNull();
      }
    }
  });

  test("returns null when Spotify refuses the token or fails", async () => {
    for (const status of [401, 403, 500]) {
      network.use(http.get(url, async () => Response.json({ error: { status } }, { status })));

      const exit = await runWithSpotify(
        Effect.gen(function* () {
          const spotify = yield* SpotifyClient;

          return yield* spotify.forAccessToken("token-1").getCurrentlyPlaying();
        }),
      );

      expect(Exit.isSuccess(exit)).toBe(true);

      if (Exit.isSuccess(exit)) {
        expect(exit.value).toBeNull();
      }
    }
  });

  test("turns a 429 into a quota error with the retry delay", async () => {
    network.use(
      http.get(url, async () =>
        Response.json(quotaBody, { status: 429, headers: { "retry-after": "120" } }),
      ),
    );

    const exit = await runWithSpotify(
      Effect.gen(function* () {
        const spotify = yield* SpotifyClient;

        return yield* spotify.forAccessToken("token-1").getCurrentlyPlaying();
      }),
    );

    expect(Exit.isFailure(exit)).toBe(true);

    if (Exit.isFailure(exit)) {
      const error = Cause.squash(exit.cause);

      expect(error).toBeInstanceOf(SpotifyQuotaExceededError);

      if (error instanceof SpotifyQuotaExceededError) {
        expect(error.retryAfterSeconds).toBe(120);
      }
    }
  });
});
