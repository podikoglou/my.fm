import { describe, expect, spyOn, test } from "bun:test";
import { eq } from "drizzle-orm";

import type { Database } from "../src/db/index.ts";
import type { CreateSpotifyClient, SpotifyPlay } from "../src/ingestion/spotify.ts";

import { createDatabase } from "../src/db/index.ts";
import { createScrobbleId } from "../src/db/queries/scrobbles.ts";
import {
  accounts,
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";
import { storePlay } from "../src/ingestion/plays.ts";
import { runIngestion } from "../src/ingestion/run.ts";
import { createTestEnv } from "./harness.ts";

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

async function seedUser(db: Database, { userId = "user-1", accessToken = "token-1" } = {}) {
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
): CreateSpotifyClient {
  return (accessToken) => ({
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

describe("storePlay", () => {
  test("stores the whole play in one batch", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const play = makePlay("2026-11-11T12:00:00.000Z");

    await seedUser(db);
    await storePlay(db, "user-1", play);

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
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const play = makePlay("2026-11-11T12:00:00.000Z");

    await seedUser(db);
    await storePlay(db, "user-1", play);
    await storePlay(db, "user-1", play);

    expect(await db.select().from(scrobbles)).toHaveLength(1);
    expect(await db.select().from(artists)).toHaveLength(3);
    expect(await db.select().from(trackArtists)).toHaveLength(2);
    expect(await db.select().from(albumArtists)).toHaveLength(2);
  });
});

describe("runIngestion", () => {
  test("fetches the initial fifty plays and advances the cursor", async () => {
    const env = createTestEnv();
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

  test("uses the regular limit and the cursor after the first fetch", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const calls: FetchCall[] = [];

    await seedUser(db);
    await db.update(users).set({ lastRecentTracksFetchTime: now }).where(eq(users.id, "user-1"));
    await runIngestion(
      env,
      clientFor(calls, () => []),
    );

    expect(calls).toEqual([
      { accessToken: "token-1", limit: 6, options: { type: "after", timestamp: now.getTime() } },
    ]);

    const user = await db.query.users.findFirst({ where: { id: "user-1" } });
    expect(user?.lastRecentTracksFetchTime?.getTime()).toBeGreaterThanOrEqual(now.getTime());
  });

  test("does not duplicate a play that is fetched again", async () => {
    const env = createTestEnv();
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
    const env = createTestEnv();
    const calls: FetchCall[] = [];

    await runIngestion(
      env,
      clientFor(calls, () => []),
    );

    expect(calls).toHaveLength(0);
  });

  test("continues with other accounts when one fetch fails", async () => {
    const env = createTestEnv();
    const db = createDatabase(env.DB);
    const seen: string[] = [];
    const error = spyOn(console, "error").mockImplementation(() => {});

    await seedUser(db, { userId: "user-1", accessToken: "token-1" });
    await seedUser(db, { userId: "user-2", accessToken: "token-2" });

    try {
      await runIngestion(env, (accessToken) => ({
        getRecentlyPlayedTracks: async () => {
          seen.push(accessToken);

          if (accessToken === "token-1") {
            throw new Error("Spotify unavailable");
          }

          return { items: [] };
        },
      }));
    } finally {
      error.mockRestore();
    }

    expect(seen).toHaveLength(2);
    expect(seen).toContain("token-1");
    expect(seen).toContain("token-2");
  });
});
