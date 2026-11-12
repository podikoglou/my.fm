import { describe, expect, test } from "bun:test";

import {
  createSpotifyClient,
  getSpotifyQuotaError,
  SpotifyQuotaExceededError,
} from "../src/ingestion/spotify.ts";
import { createTestEnv, replaceFetch } from "./harness.ts";

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
    const restoreFetch = replaceFetch(async () =>
      Response.json(quotaBody, { status: 429, headers: { "retry-after": "66362" } }),
    );

    try {
      const client = createSpotifyClient(createTestEnv(), "token-1");

      const quota = await client.getRecentlyPlayedTracks(50).then(
        () => null,
        (error: Error) => getSpotifyQuotaError(error),
      );

      expect(quota).toEqual({ retryAfterSeconds: 66_362 });
    } finally {
      restoreFetch();
    }
  });

  test("keeps the quota classification when the response has no retry delay", async () => {
    const restoreFetch = replaceFetch(async () => Response.json(quotaBody, { status: 429 }));

    try {
      const client = createSpotifyClient(createTestEnv(), "token-1");

      const quota = await client.getRecentlyPlayedTracks(50).then(
        () => null,
        (error: Error) => getSpotifyQuotaError(error),
      );

      expect(quota).toEqual({ retryAfterSeconds: null });
    } finally {
      restoreFetch();
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
      const restoreFetch = replaceFetch(async () =>
        Response.json(quotaBody, { status: 429, headers: { "retry-after": header } }),
      );

      try {
        const client = createSpotifyClient(createTestEnv(), "token-1");

        const quota = await client.getRecentlyPlayedTracks(50).then(
          () => null,
          (error: Error) => getSpotifyQuotaError(error),
        );

        expect(quota).toEqual({ retryAfterSeconds: expected });
      } finally {
        restoreFetch();
      }
    }
  });
});
