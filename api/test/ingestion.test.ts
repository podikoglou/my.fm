import { env } from "cloudflare:workers";
import { Effect, Layer } from "effect";
import { http } from "msw";
import { describe, expect, test } from "vitest";

import { AuthConfig, AuthService } from "../src/auth/service.ts";
import { findIngestionRun, recordIngestionRun } from "../src/db/queries/ingestionRuns.ts";
import { DbLive } from "../src/db/service.ts";
import { INGESTION_EVENTS } from "../src/ingestion/events.ts";
import { shouldFetchUser } from "../src/ingestion/schedule.ts";
import { Ingestion } from "../src/ingestion/service.ts";
import { Scrobbles } from "../src/scrobbles/service.ts";
import { SpotifyClientError, SpotifyQuotaExceededError } from "../src/spotify/errors.ts";
import {
  SpotifyClient,
  type RecentlyPlayedOptions,
  type SpotifyPlay,
  type SpotifyUserClient,
} from "../src/spotify/service.ts";
import { Users } from "../src/users/service.ts";
import {
  createBatchWriteLimitDatabase,
  createStatementWriteLimitDatabase,
  insertRows,
  queryRows,
  runSql,
  selectRows,
  updateRows,
} from "./d1.ts";
import { captureLogs } from "./logs.ts";
import { network } from "./network.ts";

const now = new Date("2026-11-11T12:00:00.000Z");

function makePlay(playedAt: string, trackSuffix = "1"): SpotifyPlay {
  return {
    played_at: playedAt,
    track: {
      uri: `spotify:track:${trackSuffix}`,
      name: `Track ${trackSuffix}`,
      track_number: 1,
      explicit: false,
      duration_ms: 180_000,
      artists: [
        { uri: "spotify:artist:1", name: "First Artist" },
        { uri: "spotify:artist:2", name: "Second Artist" },
      ],
      album: {
        uri: `spotify:album:${trackSuffix}`,
        name: `Album ${trackSuffix}`,
        release_date: "2026",
        total_tracks: 1,
        album_type: "album",
        images: [{ url: `https://example.com/album-${trackSuffix}.jpg` }],
        artists: [
          { uri: "spotify:artist:1", name: "First Artist" },
          { uri: "spotify:artist:3", name: "Third Artist" },
        ],
      },
    },
  };
}

async function seedUser(
  db: D1Database,
  {
    userId = "user-1",
    accessToken = "token-1",
    accessTokenExpiresAt = null,
    refreshToken = null,
  }: {
    userId?: string;
    accessToken?: string;
    accessTokenExpiresAt?: Date | null;
    refreshToken?: string | null;
  } = {},
) {
  await insertRows(db, "users", {
    id: userId,
    username: `username-${userId}`,
    name: "Test User",
    email: `${userId}@example.com`,
    updatedAt: now,
  });

  await insertRows(db, "accounts", {
    id: `account-${userId}`,
    accountId: `spotify-${userId}`,
    providerId: "spotify",
    userId,
    accessToken,
    accessTokenExpiresAt,
    refreshToken,
    createdAt: now,
    updatedAt: now,
  });
}

type FetchCall = {
  readonly accessToken: string;
  readonly limit: number;
  readonly options?: RecentlyPlayedOptions;
};

function makeMockSpotifyLayer(
  forAccessToken: (accessToken: string) => SpotifyUserClient,
): Layer.Layer<SpotifyClient> {
  return Layer.succeed(SpotifyClient, SpotifyClient.of({ forAccessToken }));
}

function mockSpotifyFor(
  calls: FetchCall[],
  getPlays: (call: FetchCall) => ReadonlyArray<SpotifyPlay>,
): Layer.Layer<SpotifyClient> {
  return makeMockSpotifyLayer((accessToken) => ({
    getRecentlyPlayedTracks: (limit, options) => {
      const call = { accessToken, limit, options };
      calls.push(call);

      return Effect.succeed({ items: getPlays(call) });
    },
  }));
}

function getIngestionRun(database: D1Database) {
  return runSql(database, findIngestionRun());
}

function saveIngestionRun(database: D1Database, values: Parameters<typeof recordIngestionRun>[0]) {
  return runSql(database, recordIngestionRun(values));
}

function runIngestionWith(options: {
  readonly db?: D1Database;
  readonly spotifyLayer: Layer.Layer<SpotifyClient>;
  readonly at?: Date;
}) {
  const db = options.db ?? env.DB;
  const dbLayer = DbLive(db);

  const authConfigLayer = AuthConfig.layer({
    betterAuthSecret: env.BETTER_AUTH_SECRET,
    spotifyClientId: env.SPOTIFY_CLIENT_ID,
    spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET,
  });

  const fullLayer = Ingestion.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        AuthService.layer,
        Scrobbles.layer.pipe(Layer.provide(Users.layer)),
        options.spotifyLayer,
      ),
    ),
    Layer.provide(Layer.mergeAll(dbLayer, authConfigLayer)),
  );

  return Effect.runPromise(
    Effect.gen(function* () {
      const ingestion = yield* Ingestion;

      yield* ingestion.run(options.at ?? now);
    }).pipe(Effect.provide(fullLayer)),
  );
}

describe("Ingestion.run", () => {
  test("fetches the initial fifty plays and advances the cursor", async () => {
    const db = env.DB;
    await seedUser(db);

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => [
          makePlay("2026-11-11T11:55:00.000Z", "1"),
          makePlay("2026-11-11T11:58:00.000Z", "2"),
        ]),
      });

      expect(calls).toEqual([{ accessToken: "token-1", limit: 50, options: undefined }]);
      expect(await selectRows(db, "scrobbles")).toHaveLength(2);

      const [user] = await queryRows<{
        lastRecentTracksFetchTime: number | null;
        lastFetchedAt: number | null;
      }>(db, "SELECT lastRecentTracksFetchTime, lastFetchedAt FROM users WHERE id = ?", ["user-1"]);

      expect(user?.lastRecentTracksFetchTime).toBe(
        Math.floor(new Date("2026-11-11T11:58:00.000Z").getTime() / 1000),
      );
      expect(user?.lastFetchedAt).toBe(now.getTime());
      expect(logs.named(INGESTION_EVENTS.accountIngested)).toEqual([
        { event: INGESTION_EVENTS.accountIngested, userId: "user-1", plays: 2 },
      ]);
    } finally {
      logs.restore();
    }
  });

  test("requests a full page and the cursor after the first fetch", async () => {
    const db = env.DB;
    await seedUser(db);

    const cursor = new Date("2026-11-11T11:00:00.000Z");

    await updateRows(
      db,
      "users",
      {
        lastRecentTracksFetchTime: cursor,
        lastFetchedAt: new Date("2026-11-11T11:45:00.000Z"),
      },
      { id: "user-1" },
    );

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => []),
      });

      expect(calls).toEqual([
        {
          accessToken: "token-1",
          limit: 50,
          options: { type: "after", timestamp: cursor.getTime() },
        },
      ]);
    } finally {
      logs.restore();
    }
  });

  test("refreshes an expired token and stores the new one", async () => {
    const db = env.DB;
    await seedUser(db, {
      accessToken: "expired-token",
      accessTokenExpiresAt: new Date("2026-11-11T10:00:00.000Z"),
      refreshToken: "refresh-token-1",
    });

    network.use(
      http.post("https://accounts.spotify.com/api/token", async () =>
        Response.json({
          access_token: "fresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "refresh-token-2",
        }),
      ),
    );

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => [makePlay("2026-11-11T11:55:00.000Z")]),
      });

      expect(calls).toEqual([{ accessToken: "fresh-token", limit: 50, options: undefined }]);

      const [account] = await queryRows<{ accessToken: string; refreshToken: string }>(
        db,
        "SELECT access_token AS accessToken, refresh_token AS refreshToken FROM accounts WHERE id = ?",
        ["account-user-1"],
      );

      expect(account?.accessToken).toBe("fresh-token");
      expect(account?.refreshToken).toBe("refresh-token-2");
    } finally {
      logs.restore();
    }
  });

  test("leaves the cursor unchanged when the token refresh fails", async () => {
    const db = env.DB;
    await seedUser(db, {
      accessToken: "expired-token",
      accessTokenExpiresAt: new Date("2026-11-11T10:00:00.000Z"),
      refreshToken: "bad-refresh-token",
    });

    network.use(
      http.post("https://accounts.spotify.com/api/token", async () =>
        Response.json({ error: "invalid_grant" }, { status: 400 }),
      ),
    );

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => [makePlay("2026-11-11T11:55:00.000Z")]),
      });

      expect(calls).toHaveLength(0);

      const [user] = await queryRows<{ lastRecentTracksFetchTime: number | null }>(
        db,
        "SELECT lastRecentTracksFetchTime FROM users WHERE id = ?",
        ["user-1"],
      );

      expect(user?.lastRecentTracksFetchTime).toBeNull();
    } finally {
      logs.restore();
    }
  });

  test("does not duplicate a play that is fetched again", async () => {
    const db = env.DB;
    await seedUser(db);

    const play = makePlay("2026-11-11T11:55:00.000Z", "1");
    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({ spotifyLayer: mockSpotifyFor(calls, () => [play]), at: now });
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => [play]),
        at: new Date(now.getTime() + 15 * 60_000),
      });

      expect(await selectRows(db, "scrobbles")).toHaveLength(1);
    } finally {
      logs.restore();
    }
  });

  test("continues with other accounts when one fetch fails", async () => {
    const db = env.DB;
    await seedUser(db, { userId: "user-1", accessToken: "token-1" });
    await seedUser(db, { userId: "user-2", accessToken: "token-2" });

    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: makeMockSpotifyLayer((accessToken) => ({
          getRecentlyPlayedTracks: () => {
            if (accessToken === "token-1") {
              return Effect.fail(new SpotifyClientError({ cause: new Error("Spotify down") }));
            }

            return Effect.succeed({ items: [makePlay("2026-11-11T11:55:00.000Z")] });
          },
        })),
      });

      expect(await selectRows(db, "scrobbles")).toHaveLength(1);
      expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
        expect.objectContaining({ status: "partial", failures: 1, fetched: 1, plays: 1 }),
      ]);
    } finally {
      logs.restore();
    }
  });

  test("continues with other accounts when a play timestamp is malformed", async () => {
    const db = env.DB;
    await seedUser(db, { userId: "user-1", accessToken: "token-1" });
    await seedUser(db, { userId: "user-2", accessToken: "token-2" });

    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: makeMockSpotifyLayer((accessToken) => ({
          getRecentlyPlayedTracks: () => {
            if (accessToken === "token-1") {
              return Effect.succeed({ items: [makePlay("not-a-valid-date")] });
            }

            return Effect.succeed({ items: [makePlay("2026-11-11T11:55:00.000Z")] });
          },
        })),
      });

      expect(await selectRows(db, "scrobbles")).toHaveLength(1);
      expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
        expect.objectContaining({ status: "partial", failures: 1, fetched: 1, plays: 1 }),
      ]);

      const heartbeat = await getIngestionRun(db);

      expect(heartbeat?.status).toBe("partial");
    } finally {
      logs.restore();
    }
  });

  test("stops the run when Spotify reports a quota error", async () => {
    const db = env.DB;
    await seedUser(db, { userId: "user-1", accessToken: "token-1" });
    await seedUser(db, { userId: "user-2", accessToken: "token-2" });

    const seen: string[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: makeMockSpotifyLayer((accessToken) => ({
          getRecentlyPlayedTracks: () => {
            seen.push(accessToken);

            return Effect.fail(new SpotifyQuotaExceededError({ retryAfterSeconds: 600 }));
          },
        })),
      });

      expect(seen).toEqual(["token-1"]);

      const heartbeat = await getIngestionRun(db);

      expect(heartbeat?.status).toBe("quota");
      expect(heartbeat?.blockedUntil).toEqual(new Date(now.getTime() + 600 * 1000));
    } finally {
      logs.restore();
    }
  });

  test("skips a run that is still inside a block", async () => {
    const db = env.DB;
    await seedUser(db);

    const blockedUntil = new Date(now.getTime() + 10 * 60_000);

    await saveIngestionRun(db, { at: now, status: "quota", blockedUntil });

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => [makePlay("2026-11-11T11:55:00.000Z")]),
        at: new Date(now.getTime() + 5 * 60_000),
      });

      expect(calls).toHaveLength(0);
      expect(logs.named(INGESTION_EVENTS.runSkipped)).toEqual([
        { event: INGESTION_EVENTS.runSkipped, blockedUntil: blockedUntil.toISOString() },
      ]);
    } finally {
      logs.restore();
    }
  });

  test("resumes after the stored block ends", async () => {
    const db = env.DB;
    await seedUser(db);

    const blockedUntil = new Date(now.getTime() + 10 * 60_000);

    await saveIngestionRun(db, { at: now, status: "quota", blockedUntil });

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => [makePlay("2026-11-11T12:05:00.000Z")]),
        at: new Date(now.getTime() + 11 * 60_000),
      });

      expect(calls).toHaveLength(1);
      expect(await selectRows(db, "scrobbles")).toHaveLength(1);
    } finally {
      logs.restore();
    }
  });

  test("blocks for at least five minutes after a short Retry-After", async () => {
    const db = env.DB;
    await seedUser(db);

    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: makeMockSpotifyLayer(() => ({
          getRecentlyPlayedTracks: () =>
            Effect.fail(new SpotifyQuotaExceededError({ retryAfterSeconds: 1 })),
        })),
      });

      const heartbeat = await getIngestionRun(db);

      expect(heartbeat?.blockedUntil).toEqual(new Date(now.getTime() + 5 * 60 * 1000));
    } finally {
      logs.restore();
    }
  });

  test("clamps a long block to one day", async () => {
    const db = env.DB;
    await seedUser(db);

    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: makeMockSpotifyLayer(() => ({
          getRecentlyPlayedTracks: () =>
            Effect.fail(new SpotifyQuotaExceededError({ retryAfterSeconds: 48 * 60 * 60 })),
        })),
      });

      const heartbeat = await getIngestionRun(db);

      expect(heartbeat?.blockedUntil).toEqual(new Date(now.getTime() + 24 * 60 * 60 * 1000));
    } finally {
      logs.restore();
    }
  });

  test("fetches a user once when a second Spotify account is linked", async () => {
    const db = env.DB;
    await seedUser(db, { userId: "user-1", accessToken: "token-1" });

    await insertRows(db, "accounts", {
      id: "account-user-1-dup",
      accountId: "spotify-user-1-dup",
      providerId: "spotify",
      userId: "user-1",
      accessToken: "token-dup",
      createdAt: now,
      updatedAt: now,
    });

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => []),
      });

      expect(calls).toHaveLength(1);
      expect(calls[0]?.accessToken).toBe("token-1");
    } finally {
      logs.restore();
    }
  });

  test("records one heartbeat per run", async () => {
    const db = env.DB;
    const logs = captureLogs();

    try {
      await runIngestionWith({ spotifyLayer: mockSpotifyFor([], () => []), at: now });
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor([], () => []),
        at: new Date(now.getTime() + 60_000),
      });

      const rows = await selectRows(db, "ingestion_runs");
      expect(rows).toHaveLength(1);
      expect(rows[0]?.lastRunAt).toEqual(new Date(now.getTime() + 60_000));
    } finally {
      logs.restore();
    }
  });

  test("stops the run without a heartbeat when D1 rejects the store", async () => {
    const db = env.DB;
    await seedUser(db);

    const logs = captureLogs();

    try {
      await runIngestionWith({
        db: createBatchWriteLimitDatabase(env.DB),
        spotifyLayer: mockSpotifyFor([], () => [makePlay("2026-11-11T11:55:00.000Z")]),
      });

      const rows = await selectRows(db, "ingestion_runs");
      expect(rows).toHaveLength(0);
      expect(logs.messages.some((args) => args[0] === INGESTION_EVENTS.d1WriteLimit)).toBe(true);
    } finally {
      logs.restore();
    }
  });

  test("reports the limit when the heartbeat write is the failure", async () => {
    const logs = captureLogs();

    try {
      await runIngestionWith({
        db: createStatementWriteLimitDatabase(env.DB),
        spotifyLayer: mockSpotifyFor([], () => []),
      });

      expect(logs.messages.some((args) => args[0] === INGESTION_EVENTS.d1WriteLimit)).toBe(true);
    } finally {
      logs.restore();
    }
  });
});

describe("shouldFetchUser", () => {
  test("fetches immediately if user was never fetched", () => {
    expect(shouldFetchUser({ lastFetchedAt: null, lastActiveAt: null }, now)).toBe(true);
  });

  test("fetches immediately if cursor was reset to null", () => {
    expect(
      shouldFetchUser(
        {
          lastFetchedAt: new Date(now.getTime() - 60_000),
          lastActiveAt: null,
          lastRecentTracksFetchTime: null,
        },
        now,
      ),
    ).toBe(true);
  });

  test("skips inactive user when fetch interval has not elapsed", () => {
    expect(
      shouldFetchUser(
        {
          lastFetchedAt: new Date(now.getTime() - 5 * 60_000),
          lastActiveAt: null,
          lastRecentTracksFetchTime: new Date(now.getTime() - 60 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  test("fetches inactive user when fetch interval has elapsed", () => {
    expect(
      shouldFetchUser(
        {
          lastFetchedAt: new Date(now.getTime() - 10 * 60_000),
          lastActiveAt: null,
          lastRecentTracksFetchTime: new Date(now.getTime() - 60 * 60_000),
        },
        now,
      ),
    ).toBe(true);
  });

  test("skips active user when active interval has not elapsed", () => {
    expect(
      shouldFetchUser(
        {
          lastFetchedAt: new Date(now.getTime() - 2 * 60_000),
          lastActiveAt: new Date(now.getTime() - 5 * 60_000),
          lastRecentTracksFetchTime: new Date(now.getTime() - 5 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });

  test("fetches active user when active interval has elapsed", () => {
    expect(
      shouldFetchUser(
        {
          lastFetchedAt: new Date(now.getTime() - 3 * 60_000),
          lastActiveAt: new Date(now.getTime() - 5 * 60_000),
          lastRecentTracksFetchTime: new Date(now.getTime() - 5 * 60_000),
        },
        now,
      ),
    ).toBe(true);
  });

  test("treats user as inactive once active window has expired", () => {
    expect(
      shouldFetchUser(
        {
          lastFetchedAt: new Date(now.getTime() - 5 * 60_000),
          lastActiveAt: new Date(now.getTime() - 15 * 60_000),
          lastRecentTracksFetchTime: new Date(now.getTime() - 20 * 60_000),
        },
        now,
      ),
    ).toBe(false);
  });
});

describe("dynamic fetch intervals in Ingestion.run", () => {
  test("skips inactive user on subsequent tick within 10-minute window", async () => {
    const db = env.DB;
    await seedUser(db);

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({ spotifyLayer: mockSpotifyFor(calls, () => []), at: now });
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => []),
        at: new Date(now.getTime() + 5 * 60_000),
      });

      expect(calls).toHaveLength(1);
    } finally {
      logs.restore();
    }
  });

  test("fetches inactive user after 10 minutes", async () => {
    const db = env.DB;
    await seedUser(db);

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({ spotifyLayer: mockSpotifyFor(calls, () => []), at: now });
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => []),
        at: new Date(now.getTime() + 10 * 60_000),
      });

      expect(calls).toHaveLength(2);
    } finally {
      logs.restore();
    }
  });

  test("promotes user to active when recent plays are found and fetches them 3 minutes later", async () => {
    const db = env.DB;
    await seedUser(db);

    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => [makePlay("2026-11-11T11:58:00.000Z")]),
        at: now,
      });

      await runIngestionWith({
        spotifyLayer: mockSpotifyFor(calls, () => []),
        at: new Date(now.getTime() + 3 * 60_000),
      });

      expect(calls).toHaveLength(2);
    } finally {
      logs.restore();
    }
  });
});
