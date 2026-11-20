import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { http } from "msw";
import { describe, expect, vi, test } from "vitest";

import type { Database } from "../src/db/index.ts";
import type {
  CreateSpotifyClient,
  SpotifyPlay,
  SpotifyPlayback,
} from "../src/ingestion/spotify.ts";

import { createDatabase } from "../src/db/index.ts";
import { findIngestionRun, recordIngestionRun } from "../src/db/queries/ingestionRuns.ts";
import { createScrobbleId } from "../src/db/queries/scrobbles.ts";
import {
  accounts,
  albumArtists,
  albums,
  artists,
  ingestionRuns,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";
import { INGESTION_EVENTS } from "../src/ingestion/events.ts";
import { storePlays } from "../src/ingestion/plays.ts";
import { runIngestion, shouldFetchHistory, shouldFetchUser } from "../src/ingestion/run.ts";
import { SpotifyQuotaExceededError } from "../src/ingestion/spotify.ts";
import {
  createBatchWriteLimitDatabase,
  createFailingUpdateDatabase,
  createStatementWriteLimitDatabase,
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
  db: Database,
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
  await db.insert(users).values({
    id: userId,
    username: `username-${userId}`,
    name: "Test User",
    email: `${userId}@example.com`,
    updatedAt: now,
  });

  await db.insert(accounts).values({
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
  accessToken: string;
  limit: number;
  options?: { type: "after"; timestamp: number };
};

function clientFor(
  calls: FetchCall[],
  getPlays: (call: FetchCall) => SpotifyPlay[],
  getPlayback: () => SpotifyPlayback | null = () => null,
): CreateSpotifyClient {
  return (accessToken) => ({
    getCurrentlyPlaying: async () => getPlayback(),
    getRecentlyPlayedTracks: async (limit, options) => {
      const call = { accessToken, limit, options };
      calls.push(call);

      return { items: getPlays(call) };
    },
  });
}

describe("scrobble IDs", () => {
  test("are deterministic, lowercase hex, and distinct per user and play", async () => {
    const id = await createScrobbleId("user-1", now);

    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(await createScrobbleId("user-1", now)).toBe(id);
    expect(await createScrobbleId("user-2", now)).not.toBe(id);
    expect(await createScrobbleId("user-1", new Date("2026-11-11T12:00:01.000Z"))).not.toBe(id);
  });
});

describe("storePlays", () => {
  test("stores the whole play in one batch", async () => {
    const db = createDatabase(env.DB);
    const play = makePlay("2026-11-11T12:00:00.000Z");

    await seedUser(db);
    await storePlays(db, "user-1", [play]);

    const storedArtists = await db.select().from(artists).orderBy(artists.spotifyUri);
    expect(storedArtists.map((artist) => artist.name)).toEqual([
      "First Artist",
      "Second Artist",
      "Third Artist",
    ]);

    const [album] = await db.select().from(albums);
    expect(album).toMatchObject({
      spotifyUri: "spotify:album:1",
      name: "Album 1",
      releaseDate: "2026",
      totalTracks: 1,
      albumType: "album",
      imageUrl: "https://example.com/album-1.jpg",
    });

    const [track] = await db.select().from(tracks);
    expect(track).toMatchObject({
      spotifyUri: "spotify:track:1",
      name: "Track 1",
      trackNumber: 1,
      releaseDate: "2026",
      imageUrl: "https://example.com/album-1.jpg",
      explicit: false,
      duration: 180_000,
    });

    const storedTrackArtists = await db.select().from(trackArtists).orderBy(trackArtists.position);
    expect(
      storedTrackArtists.map(({ artistSpotifyUri, position }) => [artistSpotifyUri, position]),
    ).toEqual([
      ["spotify:artist:1", 0],
      ["spotify:artist:2", 1],
    ]);

    const storedAlbumArtists = await db.select().from(albumArtists).orderBy(albumArtists.position);
    expect(
      storedAlbumArtists.map(({ artistSpotifyUri, position }) => [artistSpotifyUri, position]),
    ).toEqual([
      ["spotify:artist:1", 0],
      ["spotify:artist:3", 1],
    ]);

    const [scrobble] = await db.select().from(scrobbles);
    expect(scrobble?.id).toBe(await createScrobbleId("user-1", new Date(play.played_at)));
    expect(scrobble?.userId).toBe("user-1");
    expect(scrobble?.trackSpotifyUri).toBe("spotify:track:1");
    expect(scrobble?.albumSpotifyUri).toBe("spotify:album:1");
  });

  test("is idempotent when the same play is fetched again", async () => {
    const db = createDatabase(env.DB);
    const play = makePlay("2026-11-11T12:00:00.000Z");

    await seedUser(db);
    await storePlays(db, "user-1", [play]);
    await storePlays(db, "user-1", [play]);

    expect(await db.select().from(scrobbles)).toHaveLength(1);
    expect(await db.select().from(artists)).toHaveLength(3);
    expect(await db.select().from(trackArtists)).toHaveLength(2);
    expect(await db.select().from(albumArtists)).toHaveLength(2);
  });

  test("splits a large fetch into bounded batches", async () => {
    const batch = vi.spyOn(env.DB, "batch");
    const db = createDatabase(env.DB);

    const plays = Array.from({ length: 12 }, (_, index) =>
      makePlay(new Date(now.getTime() + index * 60_000).toISOString(), String(index)),
    );

    await seedUser(db);
    await storePlays(db, "user-1", plays);

    expect(batch).toHaveBeenCalledTimes(2);
    expect(await db.select().from(scrobbles)).toHaveLength(12);
  });
});

describe("runIngestion", () => {
  test("fetches the initial fifty plays and advances the cursor", async () => {
    const db = createDatabase(env.DB);
    const plays = [makePlay("2026-11-11T12:00:00.000Z"), makePlay("2026-11-11T12:01:00.000Z", "2")];
    const calls: FetchCall[] = [];

    await seedUser(db);
    await runIngestion(
      env,
      clientFor(calls, () => plays),
    );

    expect(calls).toEqual([{ accessToken: "token-1", limit: 50, options: undefined }]);
    expect(await db.select().from(scrobbles)).toHaveLength(2);

    const user = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(user?.lastRecentTracksFetchTime?.toISOString()).toBe("2026-11-11T12:01:00.000Z");
  });

  test("requests a full page and the cursor after the first fetch", async () => {
    const db = createDatabase(env.DB);
    const calls: FetchCall[] = [];

    await seedUser(db);
    await db.update(users).set({ lastRecentTracksFetchTime: now }).where(eq(users.id, "user-1"));
    await runIngestion(
      env,
      clientFor(calls, () => []),
    );

    expect(calls).toEqual([
      { accessToken: "token-1", limit: 50, options: { type: "after", timestamp: now.getTime() } },
    ]);

    const user = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(user?.lastRecentTracksFetchTime?.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  test("refreshes an expired token and stores the new one", async () => {
    const db = createDatabase(env.DB);
    const calls: FetchCall[] = [];
    let refreshBody = "";

    await seedUser(db, {
      accessToken: "expired-token",
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
      refreshToken: "refresh-token",
    });

    network.use(
      http.post("https://accounts.spotify.com/api/token", async ({ request }) => {
        refreshBody = await request.text();

        return Response.json({
          access_token: "fresh-token",
          token_type: "Bearer",
          expires_in: 3600,
          refresh_token: "new-refresh-token",
        });
      }),
    );

    await runIngestion(
      env,
      clientFor(calls, () => []),
    );

    expect(calls).toEqual([{ accessToken: "fresh-token", limit: 50, options: undefined }]);
    expect(refreshBody).toContain("grant_type=refresh_token");
    expect(refreshBody).toContain("refresh_token=refresh-token");

    const account = await db.query.accounts.findFirst({ where: { id: "account-user-1" } });
    expect(account?.accessToken).toBe("fresh-token");
    expect(account?.refreshToken).toBe("new-refresh-token");
  });

  test("leaves the cursor unchanged when the token refresh fails", async () => {
    const db = createDatabase(env.DB);
    const calls: FetchCall[] = [];
    const cursor = new Date("2026-11-01T00:00:00.000Z");
    const logs = captureLogs();

    await seedUser(db, {
      accessToken: "expired-token",
      accessTokenExpiresAt: new Date(Date.now() - 60_000),
      refreshToken: "refresh-token",
    });
    await db.update(users).set({ lastRecentTracksFetchTime: cursor }).where(eq(users.id, "user-1"));

    network.use(
      http.post(
        "https://accounts.spotify.com/api/token",
        () => new Response("unauthorized", { status: 401 }),
      ),
    );

    try {
      await runIngestion(
        env,
        clientFor(calls, () => []),
      );
    } finally {
      logs.restore();
    }

    expect(calls).toHaveLength(0);

    const user = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(user?.lastRecentTracksFetchTime?.toISOString()).toBe(cursor.toISOString());
  });

  test("rolls back a failed chunk and leaves the cursor unchanged", async () => {
    const db = createDatabase(env.DB);
    const cursor = new Date("2026-11-01T00:00:00.000Z");
    const logs = captureLogs();

    const plays = Array.from({ length: 12 }, (_, index) =>
      makePlay(new Date(now.getTime() + index * 60_000).toISOString(), String(index)),
    );

    const lastPlay = plays.at(-1);

    if (!lastPlay) {
      throw new Error("missing test play");
    }

    // SAFETY: The database must reject a null track name. Spotify's types
    // require a string, so this test injects the invalid value deliberately.
    lastPlay.track.name = null as never;

    await seedUser(db);
    await db.update(users).set({ lastRecentTracksFetchTime: cursor }).where(eq(users.id, "user-1"));

    try {
      await runIngestion(
        env,
        clientFor([], () => plays),
      );
    } finally {
      logs.restore();
    }

    expect(await db.select().from(scrobbles)).toHaveLength(10);

    const user = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(user?.lastRecentTracksFetchTime?.toISOString()).toBe(cursor.toISOString());
  });

  test("does not duplicate a play that is fetched again", async () => {
    const db = createDatabase(env.DB);
    const plays = [makePlay("2026-11-11T12:00:00.000Z")];

    await seedUser(db);
    await runIngestion(
      env,
      clientFor([], () => plays),
    );
    await db.update(users).set({ lastRecentTracksFetchTime: null }).where(eq(users.id, "user-1"));
    await runIngestion(
      env,
      clientFor([], () => plays),
    );

    expect(await db.select().from(scrobbles)).toHaveLength(1);
  });

  test("does nothing when no Spotify accounts exist", async () => {
    const calls: FetchCall[] = [];

    await runIngestion(
      env,
      clientFor(calls, () => []),
    );

    expect(calls).toHaveLength(0);
  });

  test("continues with other accounts when one fetch fails", async () => {
    const db = createDatabase(env.DB);
    const seen: string[] = [];
    const logs = captureLogs();

    await seedUser(db, { userId: "user-1", accessToken: "token-1" });
    await seedUser(db, { userId: "user-2", accessToken: "token-2" });

    try {
      await runIngestion(env, (accessToken) => ({
        getCurrentlyPlaying: async () => null,
        getRecentlyPlayedTracks: async () => {
          seen.push(accessToken);

          if (accessToken === "token-1") {
            throw new Error("Spotify unavailable");
          }

          return { items: [] };
        },
      }));
    } finally {
      logs.restore();
    }

    expect(seen).toHaveLength(2);
    expect(seen).toContain("token-1");
    expect(seen).toContain("token-2");
  });

  test("stops the run when Spotify reports a quota error", async () => {
    const db = createDatabase(env.DB);
    const seen: string[] = [];
    const logs = captureLogs();

    try {
      await seedUser(db, { userId: "user-1", accessToken: "token-1" });
      await seedUser(db, { userId: "user-2", accessToken: "token-2" });

      await runIngestion(env, (accessToken) => ({
        getCurrentlyPlaying: async () => null,
        getRecentlyPlayedTracks: async () => {
          seen.push(accessToken);

          // The exact error that the SDK throws for an HTTP 429.
          throw new Error("The app has exceeded its rate limits.");
        },
      }));
    } finally {
      logs.restore();
    }

    // Both accounts share the application quota, so the second account must
    // not reach Spotify.
    expect(seen).toHaveLength(1);
    expect(logs.messages).toContainEqual([INGESTION_EVENTS.quotaExhausted]);
    expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
      expect.objectContaining({
        status: "quota",
        accounts: 1,
        plays: 0,
        failures: 0,
        // The SDK error keeps no headers, so the run uses the fallback wait.
        retryAfterSeconds: 30 * 60,
      }),
    ]);

    const heartbeat = await findIngestionRun(db);
    const waitMs = heartbeat!.blockedUntil!.getTime() - Date.now();

    expect(waitMs).toBeGreaterThan(29 * 60_000);
    expect(waitMs).toBeLessThanOrEqual(30 * 60_000);
  });

  test("skips a run that is still inside a block", async () => {
    const db = createDatabase(env.DB);
    const calls: FetchCall[] = [];
    const logs = captureLogs();
    const blockedUntil = new Date(Date.now() + 60_000);

    try {
      await seedUser(db, { userId: "user-1", accessToken: "token-1" });
      await recordIngestionRun(db, { at: new Date(), status: "quota", blockedUntil });

      await runIngestion(
        env,
        clientFor(calls, () => []),
      );
    } finally {
      logs.restore();
    }

    // No request may reach Spotify during a block.
    expect(calls).toHaveLength(0);
    expect(logs.named(INGESTION_EVENTS.runSkipped)).toEqual([
      expect.objectContaining({ retryAfterSeconds: 60 }),
    ]);
    // The block must not produce a second error report.
    expect(logs.messages).toHaveLength(0);

    const heartbeat = await findIngestionRun(db);

    expect(heartbeat?.status).toBe("quota");
    expect(heartbeat?.blockedUntil?.getTime()).toBe(blockedUntil.getTime());
  });

  test("leaves the cursor unchanged while Spotify blocks the account", async () => {
    const db = createDatabase(env.DB);
    const cursor = new Date("2026-11-01T00:00:00.000Z");
    const logs = captureLogs();

    const blocked: CreateSpotifyClient = () => ({
      getCurrentlyPlaying: async () => null,
      getRecentlyPlayedTracks: async () => {
        throw new Error("The app has exceeded its rate limits.");
      },
    });

    try {
      await seedUser(db, { userId: "user-1", accessToken: "token-1" });
      await db
        .update(users)
        .set({ lastRecentTracksFetchTime: cursor })
        .where(eq(users.id, "user-1"));

      await runIngestion(env, blocked);
    } finally {
      logs.restore();
    }

    const blockedUser = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(blockedUser?.lastRecentTracksFetchTime?.toISOString()).toBe(cursor.toISOString());
    expect(await db.select().from(scrobbles)).toHaveLength(0);
  });

  test("resumes after the stored block ends", async () => {
    const db = createDatabase(env.DB);

    await seedUser(db, { userId: "user-1", accessToken: "token-1" });
    await recordIngestionRun(db, {
      at: new Date(),
      status: "quota",
      blockedUntil: new Date(Date.now() - 1000),
    });

    await runIngestion(
      env,
      clientFor([], () => [makePlay("2026-11-11T12:00:00.000Z")]),
    );

    expect(await db.select().from(scrobbles)).toHaveLength(1);
    expect((await findIngestionRun(db))?.blockedUntil).toBeNull();
  });

  test("clamps a long block to one day", async () => {
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    try {
      await seedUser(db, { userId: "user-1", accessToken: "token-1" });

      await runIngestion(env, () => ({
        getCurrentlyPlaying: async () => null,
        getRecentlyPlayedTracks: async () => {
          throw new SpotifyQuotaExceededError(10 * 24 * 60 * 60);
        },
      }));
    } finally {
      logs.restore();
    }

    const heartbeat = await findIngestionRun(db);
    const waitMs = heartbeat!.blockedUntil!.getTime() - Date.now();

    expect(waitMs).toBeLessThanOrEqual(24 * 60 * 60_000);
    expect(waitMs).toBeGreaterThan(23 * 60 * 60_000);
  });

  test("continues with the next account when one fetch fails for another reason", async () => {
    const db = createDatabase(env.DB);
    const seen: string[] = [];
    const logs = captureLogs();

    try {
      await seedUser(db, { userId: "user-1", accessToken: "token-1" });
      await seedUser(db, { userId: "user-2", accessToken: "token-2" });

      await runIngestion(env, (accessToken) => ({
        getCurrentlyPlaying: async () => null,
        getRecentlyPlayedTracks: async () => {
          seen.push(accessToken);

          // The error that the SDK throws for a server error.
          throw new Error("Unrecognised response code: 500 - Internal Server Error. Body: {}");
        },
      }));
    } finally {
      logs.restore();
    }

    expect(seen).toHaveLength(2);
  });

  test("logs the retry delay from a quota error", async () => {
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    try {
      await seedUser(db, { userId: "user-1", accessToken: "token-1" });

      await runIngestion(env, () => ({
        getCurrentlyPlaying: async () => null,
        getRecentlyPlayedTracks: async () => {
          throw new SpotifyQuotaExceededError(66_362);
        },
      }));
    } finally {
      logs.restore();
    }

    expect(logs.messages).toContainEqual([INGESTION_EVENTS.quotaExhausted]);
    expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
      expect.objectContaining({ status: "quota", retryAfterSeconds: 66_362 }),
    ]);
  });

  test("fetches a user once when a second Spotify account is linked", async () => {
    const db = createDatabase(env.DB);
    const calls: FetchCall[] = [];

    await seedUser(db);
    await db.insert(accounts).values({
      id: "account-user-1-second",
      accountId: "spotify-user-1-second",
      providerId: "spotify",
      userId: "user-1",
      accessToken: "token-2",
      createdAt: now,
      updatedAt: now,
    });

    await runIngestion(
      env,
      clientFor(calls, () => []),
    );

    expect(calls).toHaveLength(1);
    expect(["token-1", "token-2"].includes(calls[0]?.accessToken ?? "")).toBe(true);
  });

  test("logs one run-complete event per run with the stored totals", async () => {
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    const plays = [makePlay("2026-11-11T12:00:00.000Z"), makePlay("2026-11-11T12:01:00.000Z", "2")];

    try {
      await seedUser(db);
      await runIngestion(
        env,
        clientFor([], () => plays),
      );
    } finally {
      logs.restore();
    }

    expect(logs.named(INGESTION_EVENTS.accountIngested)).toEqual([
      expect.objectContaining({ userId: "user-1", plays: 2 }),
    ]);
    expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
      expect.objectContaining({ status: "ok", accounts: 1, plays: 2, failures: 0 }),
    ]);
  });

  test("counts a failed account in the run-complete event", async () => {
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    try {
      await seedUser(db);
      await runIngestion(env, () => ({
        getCurrentlyPlaying: async () => null,
        getRecentlyPlayedTracks: async () => {
          throw new Error("Spotify unavailable");
        },
      }));
    } finally {
      logs.restore();
    }

    const [failure] = logs.messages.filter(
      ([message]) => message === INGESTION_EVENTS.accountFailed,
    );

    expect(failure?.[1]).toEqual({ name: "Error", message: "Spotify unavailable", causes: [] });
    expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
      expect.objectContaining({ status: "partial", accounts: 1, plays: 0, failures: 1 }),
    ]);
  });

  test("records one heartbeat per run", async () => {
    const db = createDatabase(env.DB);
    const logs = captureLogs();
    const before = Date.now();

    await seedUser(db);

    try {
      await runIngestion(env, () => ({
        getCurrentlyPlaying: async () => null,
        getRecentlyPlayedTracks: async () => {
          throw new Error("Spotify unavailable");
        },
      }));
    } finally {
      logs.restore();
    }

    const heartbeat = await findIngestionRun(db);

    expect(heartbeat?.status).toBe("partial");
    expect(heartbeat?.lastRunAt.getTime()).toBeGreaterThanOrEqual(before);

    await runIngestion(
      env,
      clientFor([], () => []),
    );

    const updated = await findIngestionRun(db);

    expect(updated?.status).toBe("ok");
    expect(await db.select().from(ingestionRuns)).toHaveLength(1);
  });

  test("stops the run without a heartbeat when D1 rejects the store", async () => {
    const db = createDatabase(env.DB);
    const calls: FetchCall[] = [];
    const logs = captureLogs();

    try {
      await seedUser(db);
      await runIngestion(
        { ...env, DB: createBatchWriteLimitDatabase(env.DB) },
        clientFor(calls, () => [makePlay("2026-11-11T12:00:00.000Z")]),
      );
    } finally {
      logs.restore();
    }

    expect(calls).toHaveLength(1);
    expect(
      logs.messages.filter(([message]) => message === INGESTION_EVENTS.d1WriteLimit),
    ).toHaveLength(1);
    expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([]);
    expect(await db.select().from(ingestionRuns)).toHaveLength(0);
    expect(await db.select().from(scrobbles)).toHaveLength(0);

    const user = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(user?.lastRecentTracksFetchTime).toBeNull();
  });

  test("reports the limit when the heartbeat write is the failure", async () => {
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    try {
      await runIngestion(
        { ...env, DB: createStatementWriteLimitDatabase(env.DB) },
        clientFor([], () => []),
      );
    } finally {
      logs.restore();
    }

    expect(
      logs.messages.filter(([message]) => message === INGESTION_EVENTS.d1WriteLimit),
    ).toHaveLength(1);
    expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
      expect.objectContaining({ status: "ok", accounts: 0, plays: 0, failures: 0 }),
    ]);
    expect(await db.select().from(ingestionRuns)).toHaveLength(0);
  });

  test("logs the cause message of a wrapped update failure", async () => {
    const db = createDatabase(env.DB);
    const logs = captureLogs();

    try {
      await seedUser(db);
      await runIngestion(
        {
          ...env,
          DB: createFailingUpdateDatabase("D1_ERROR: FOREIGN KEY constraint failed", env.DB),
        },
        clientFor([], () => [makePlay("2026-11-11T12:00:00.000Z")]),
      );
    } finally {
      logs.restore();
    }

    const [failure] = logs.messages.filter(
      ([message]) => message === INGESTION_EVENTS.accountFailed,
    );

    expect(failure?.[1]).toMatchObject({
      name: "DrizzleQueryError",
      causes: ["D1_ERROR: FOREIGN KEY constraint failed"],
    });
    expect(logs.named(INGESTION_EVENTS.runComplete)).toEqual([
      expect.objectContaining({ status: "partial", accounts: 1, plays: 0, failures: 1 }),
    ]);
  });
});

describe("shouldFetchUser", () => {
  const baseTime = new Date("2026-11-16T12:00:00.000Z");

  test("fetches immediately if user was never fetched", () => {
    expect(shouldFetchUser({ lastFetchedAt: null, lastActiveAt: null }, baseTime)).toBe(true);
  });

  test("fetches immediately if cursor was reset to null", () => {
    expect(
      shouldFetchUser(
        {
          lastFetchedAt: new Date(baseTime.getTime() - 60_000),
          lastRecentTracksFetchTime: null,
          lastActiveAt: null,
        },
        baseTime,
      ),
    ).toBe(true);
  });

  test("skips inactive user when fetch interval has not elapsed", () => {
    // Fetched 5 minutes ago (< 10 min inactive interval)
    const lastFetchedAt = new Date(baseTime.getTime() - 5 * 60_000);
    expect(
      shouldFetchUser(
        { lastFetchedAt, lastActiveAt: null, lastRecentTracksFetchTime: lastFetchedAt },
        baseTime,
      ),
    ).toBe(false);
  });

  test("fetches inactive user when fetch interval has elapsed", () => {
    // Fetched 10 minutes ago (>= 10 min inactive interval)
    const lastFetchedAt = new Date(baseTime.getTime() - 10 * 60_000);
    expect(
      shouldFetchUser(
        { lastFetchedAt, lastActiveAt: null, lastRecentTracksFetchTime: lastFetchedAt },
        baseTime,
      ),
    ).toBe(true);
  });

  test("skips active user when active interval has not elapsed", () => {
    // Active 2 min ago, fetched 2 min ago (< 3 min active interval)
    const lastActiveAt = new Date(baseTime.getTime() - 2 * 60_000);
    const lastFetchedAt = new Date(baseTime.getTime() - 2 * 60_000);
    expect(
      shouldFetchUser(
        { lastFetchedAt, lastActiveAt, lastRecentTracksFetchTime: lastFetchedAt },
        baseTime,
      ),
    ).toBe(false);
  });

  test("fetches active user when active interval has elapsed", () => {
    // Active 2 min ago, fetched 3 min ago (>= 3 min active interval)
    const lastActiveAt = new Date(baseTime.getTime() - 2 * 60_000);
    const lastFetchedAt = new Date(baseTime.getTime() - 3 * 60_000);
    expect(
      shouldFetchUser(
        { lastFetchedAt, lastActiveAt, lastRecentTracksFetchTime: lastFetchedAt },
        baseTime,
      ),
    ).toBe(true);
  });

  test("treats user as inactive once active window has expired", () => {
    // Active 16 minutes ago (> 15 min active window), fetched 2 minutes ago (< 10 min inactive interval)
    const lastActiveAt = new Date(baseTime.getTime() - 16 * 60_000);
    const lastFetchedAt = new Date(baseTime.getTime() - 2 * 60_000);
    expect(
      shouldFetchUser(
        { lastFetchedAt, lastActiveAt, lastRecentTracksFetchTime: lastFetchedAt },
        baseTime,
      ),
    ).toBe(false);

    // After 10 minutes from last fetch, inactive user is now due
    const laterTime = new Date(baseTime.getTime() + 8 * 60_000);
    expect(
      shouldFetchUser(
        { lastFetchedAt, lastActiveAt, lastRecentTracksFetchTime: lastFetchedAt },
        laterTime,
      ),
    ).toBe(true);
  });
});

describe("dynamic fetch intervals in runIngestion", () => {
  test("skips inactive user on subsequent tick within 10-minute window", async () => {
    const db = createDatabase(env.DB);
    const t0 = new Date("2026-11-16T12:00:00.000Z");
    const t1 = new Date("2026-11-16T12:02:00.000Z"); // 2 min later
    const calls: FetchCall[] = [];

    await seedUser(db);

    // Initial run at t0: user fetched
    await runIngestion(
      env,
      clientFor(calls, () => []),
      t0,
    );
    expect(calls).toHaveLength(1);

    // Second run at t1 (2 min later): user skipped
    await runIngestion(
      env,
      clientFor(calls, () => []),
      t1,
    );
    expect(calls).toHaveLength(1); // No new Spotify call!
  });

  test("fetches inactive user after 10 minutes", async () => {
    const db = createDatabase(env.DB);
    const t0 = new Date("2026-11-16T12:00:00.000Z");
    const t10 = new Date("2026-11-16T12:10:00.000Z"); // 10 min later
    const calls: FetchCall[] = [];

    await seedUser(db);

    await runIngestion(
      env,
      clientFor(calls, () => []),
      t0,
    );
    expect(calls).toHaveLength(1);

    await runIngestion(
      env,
      clientFor(calls, () => []),
      t10,
    );
    expect(calls).toHaveLength(2); // Second Spotify call made!
  });

  test("promotes user to active when recent plays are found and fetches them 3 minutes later", async () => {
    const db = createDatabase(env.DB);
    const t0 = new Date("2026-11-16T12:00:00.000Z");
    const t3 = new Date("2026-11-16T12:03:00.000Z"); // 3 min later
    const calls: FetchCall[] = [];
    const play = makePlay("2026-11-16T11:58:00.000Z"); // played 2 min ago

    await seedUser(db);

    // First run returns recent play
    await runIngestion(
      env,
      clientFor(calls, () => [play]),
      t0,
    );
    expect(calls).toHaveLength(1);

    const user = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(user?.lastActiveAt?.getTime()).toBe(t0.getTime());

    // Second run at t3 (3 min later): active user is fetched!
    await runIngestion(
      env,
      clientFor(calls, () => []),
      t3,
    );
    expect(calls).toHaveLength(2);
  });

  test("keeps user active during 15-minute window even if fetch returns 0 plays", async () => {
    const db = createDatabase(env.DB);
    const t0 = new Date("2026-11-16T12:00:00.000Z");
    const t3 = new Date("2026-11-16T12:03:00.000Z");
    const t6 = new Date("2026-11-16T12:06:00.000Z");
    const calls: FetchCall[] = [];
    const play = makePlay("2026-11-16T11:59:00.000Z");

    await seedUser(db);

    // t0: user listens to song -> marked active
    await runIngestion(
      env,
      clientFor(calls, () => [play]),
      t0,
    );
    expect(calls).toHaveLength(1);

    // t3: active fetch returns 0 plays -> lastActiveAt stays t0
    await runIngestion(
      env,
      clientFor(calls, () => []),
      t3,
    );
    expect(calls).toHaveLength(2);

    // t6: user is still within 15-minute active window -> fetched again at t6!
    await runIngestion(
      env,
      clientFor(calls, () => []),
      t6,
    );
    expect(calls).toHaveLength(3);
  });
});

describe("now-playing polls in runIngestion", () => {
  const t0 = new Date("2026-11-16T12:00:00.000Z");
  const minutesAfter = (minutes: number) => new Date(t0.getTime() + minutes * 60_000);

  /** Run once at `t0` with a recent play, which makes the user active. */
  async function seedActiveUser(calls: FetchCall[]) {
    await seedUser(createDatabase(env.DB));

    await runIngestion(
      env,
      clientFor(calls, () => [makePlay("2026-11-16T11:58:00.000Z")]),
      t0,
    );
  }

  test("skips the history while the track of the last fetch still plays", async () => {
    const calls: FetchCall[] = [];
    let polls = 0;

    await seedActiveUser(calls);

    // The track began one minute before `t0`. The interval of an active user
    // alone would fetch the history at the fourth minute.
    for (const minutes of [1, 2, 3, 4]) {
      const playback = () => {
        polls += 1;

        return { progressMs: (minutes + 1) * 60_000 };
      };

      await runIngestion(
        env,
        clientFor(calls, () => [], playback),
        minutesAfter(minutes),
      );
    }

    expect(polls).toBe(4);
    expect(calls).toHaveLength(1);
  });

  test("fetches the history when another track began after the last fetch", async () => {
    const calls: FetchCall[] = [];

    await seedActiveUser(calls);

    await runIngestion(
      env,
      clientFor(
        calls,
        () => [],
        () => ({ progressMs: 20_000 }),
      ),
      minutesAfter(1),
    );

    expect(calls).toHaveLength(2);
  });

  test("leaves the intervals in charge when nothing plays", async () => {
    const calls: FetchCall[] = [];

    await seedActiveUser(calls);

    await runIngestion(
      env,
      clientFor(calls, () => []),
      minutesAfter(1),
    );
    expect(calls).toHaveLength(1);

    await runIngestion(
      env,
      clientFor(calls, () => []),
      minutesAfter(3),
    );
    expect(calls).toHaveLength(2);
  });

  test("does not ask an inactive user what plays", async () => {
    const calls: FetchCall[] = [];
    let polls = 0;

    const playback = () => {
      polls += 1;

      return null;
    };

    await seedUser(createDatabase(env.DB));

    for (const minutes of [0, 1, 10]) {
      await runIngestion(
        env,
        clientFor(calls, () => [], playback),
        minutesAfter(minutes),
      );
    }

    expect(polls).toBe(0);
    expect(calls).toHaveLength(2);
  });
});

describe("shouldFetchHistory", () => {
  const now = new Date("2026-11-16T12:00:00.000Z");
  const minutesAgo = (minutes: number) => new Date(now.getTime() - minutes * 60_000);

  const user = {
    lastFetchedAt: minutesAgo(4),
    lastActiveAt: minutesAgo(4),
    lastRecentTracksFetchTime: minutesAgo(6),
  };

  test("skips the fetch while the track of the last fetch still plays", () => {
    expect(shouldFetchHistory(user, { progressMs: 5 * 60_000 }, now)).toBe(false);
  });

  test("fetches when the track began after the last fetch", () => {
    expect(shouldFetchHistory(user, { progressMs: 60_000 }, now)).toBe(true);
  });

  test("fetches a long track once the inactive interval has passed", () => {
    const stale = { ...user, lastFetchedAt: minutesAgo(10) };

    expect(shouldFetchHistory(stale, { progressMs: 30 * 60_000 }, now)).toBe(true);
  });

  test("follows the intervals when nothing plays", () => {
    expect(shouldFetchHistory(user, null, now)).toBe(true);
    expect(shouldFetchHistory({ ...user, lastFetchedAt: minutesAgo(2) }, null, now)).toBe(false);
  });
});
