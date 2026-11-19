import { env } from "cloudflare:workers";
import { http } from "msw";
import { describe, expect, test } from "vitest";

import {
  createSpotifyClient,
  getSpotifyQuotaError,
  SpotifyQuotaExceededError,
} from "../src/ingestion/spotify.ts";
import { network } from "./network.ts";

/** The body that Spotify returns for a quota error. */
const quotaBody = {
  error: { status: 429, message: "Too many requests", reason: "QUOTA_EXCEEDED" },
};

/** The error that the SDK throws for an HTTP 429. */
const sdkQuotaError = "The app has exceeded its rate limits.";

describe("getSpotifyQuotaError", () => {
  test("reports the SDK quota error without a retry window", () => {
    expect(getSpotifyQuotaError(new Error(sdkQuotaError))).toEqual({ retryAfterSeconds: null });
  });

  test("reports the retry window from a client quota error", () => {
    expect(getSpotifyQuotaError(new SpotifyQuotaExceededError(66_362))).toEqual({
      retryAfterSeconds: 66_362,
    });
  });

  test("ignores other errors", () => {
    expect(getSpotifyQuotaError(new Error("Spotify unavailable"))).toBeNull();
    expect(getSpotifyQuotaError(new Error("Unrecognised response code: 500"))).toBeNull();
  });
});

describe("createSpotifyClient", () => {
  test("turns a 429 into a quota error with the retry delay", async () => {
    network.use(
      http.get("https://api.spotify.com/v1/me/player/recently-played", async () =>
        Response.json(quotaBody, { status: 429, headers: { "retry-after": "66362" } }),
      ),
    );

    const client = createSpotifyClient(env, "token-1");

    const quota = await client.getRecentlyPlayedTracks(50).then(
      () => null,
      (error: Error) => getSpotifyQuotaError(error),
    );

    expect(quota).toEqual({ retryAfterSeconds: 66_362 });
  });

  test("keeps the quota classification when the response has no retry delay", async () => {
    network.use(
      http.get("https://api.spotify.com/v1/me/player/recently-played", async () =>
        Response.json(quotaBody, { status: 429 }),
      ),
    );

    const client = createSpotifyClient(env, "token-1");

    const quota = await client.getRecentlyPlayedTracks(50).then(
      () => null,
      (error: Error) => getSpotifyQuotaError(error),
    );

    expect(quota).toEqual({ retryAfterSeconds: null });
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

      const client = createSpotifyClient(env, "token-1");

      const quota = await client.getRecentlyPlayedTracks(50).then(
        () => null,
        (error: Error) => getSpotifyQuotaError(error),
      );

      expect(quota).toEqual({ retryAfterSeconds: expected });
    }
  });
});

describe("getCurrentlyPlaying", () => {
  const url = "https://api.spotify.com/v1/me/player/currently-playing";
  const playing = { is_playing: true, currently_playing_type: "track", progress_ms: 42_000 };

  test("returns the position of the track that plays", async () => {
    network.use(http.get(url, async () => Response.json(playing)));

    expect(await createSpotifyClient(env, "token-1").getCurrentlyPlaying()).toEqual({
      progressMs: 42_000,
    });
  });

  test("returns null when no track plays", async () => {
    const answers = [
      new Response(null, { status: 204 }),
      Response.json({ ...playing, is_playing: false }),
      Response.json({ ...playing, currently_playing_type: "episode" }),
    ];

    for (const answer of answers) {
      network.use(http.get(url, async () => answer));

      expect(await createSpotifyClient(env, "token-1").getCurrentlyPlaying()).toBeNull();
    }
  });

  test("returns null when the token lacks the scope", async () => {
    for (const status of [401, 403]) {
      network.use(http.get(url, async () => Response.json({ error: { status } }, { status })));

      expect(await createSpotifyClient(env, "token-1").getCurrentlyPlaying()).toBeNull();
    }
  });

  test("turns a 429 into a quota error with the retry delay", async () => {
    network.use(
      http.get(url, async () =>
        Response.json(quotaBody, { status: 429, headers: { "retry-after": "120" } }),
      ),
    );

    const quota = await createSpotifyClient(env, "token-1")
      .getCurrentlyPlaying()
      .then(
        () => null,
        (error: Error) => getSpotifyQuotaError(error),
      );

    expect(quota).toEqual({ retryAfterSeconds: 120 });
  });

  test("throws for a server error", async () => {
    network.use(http.get(url, async () => Response.json({}, { status: 500 })));

    await expect(createSpotifyClient(env, "token-1").getCurrentlyPlaying()).rejects.toThrow();
  });
});
