import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";

import {
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";
import { createDatabase } from "../src/db/service.ts";
import { RATE_LIMITS } from "../src/rate-limits.ts";
import worker from "../src/worker.ts";
import { baseUrl } from "./session.ts";

const userId = "V1StGXR8_Z5jdHi6B-myT";
const seconds = (iso: string) => Date.parse(iso) / 1000;

let clients = 0;

/** Each call comes from its own address so the stats budget only bites where a test spends it. */
function get(path: string, ip = `198.51.100.${(clients += 1)}`) {
  return worker.fetch(
    new Request(`${baseUrl}/api/stats/${path}`, { headers: { "cf-connecting-ip": ip } }),
    env,
  );
}

async function seed() {
  const db = createDatabase(env.DB);

  await db.insert(users).values({
    id: userId,
    username: "alex",
    name: "Alex",
    email: "alex@example.com",
    updatedAt: new Date(),
    onboarded: true,
  });

  await db.insert(artists).values([
    { spotifyUri: "spotify:artist:1", name: "First Artist" },
    { spotifyUri: "spotify:artist:2", name: "Second Artist" },
  ]);

  await db.insert(albums).values(
    [1, 2].map((index) => ({
      spotifyUri: `spotify:album:${index}`,
      name: `Album ${index}`,
      releaseDate: "2026",
      totalTracks: 1,
      albumType: "album",
      imageUrl: "https://example.com/album.jpg",
    })),
  );

  await db.insert(tracks).values(
    [1, 2].map((index) => ({
      spotifyUri: `spotify:track:${index}`,
      name: `Track ${index}`,
      trackNumber: 1,
      releaseDate: "2026",
      imageUrl: "https://example.com/track.jpg",
      duration: 180_000,
    })),
  );

  // Track 2 features First Artist, but only its lead artist is credited a play.
  await db.insert(trackArtists).values([
    { trackSpotifyUri: "spotify:track:1", artistSpotifyUri: "spotify:artist:1", position: 0 },
    { trackSpotifyUri: "spotify:track:2", artistSpotifyUri: "spotify:artist:2", position: 0 },
    { trackSpotifyUri: "spotify:track:2", artistSpotifyUri: "spotify:artist:1", position: 1 },
  ]);

  await db.insert(albumArtists).values(
    [1, 2].map((index) => ({
      albumSpotifyUri: `spotify:album:${index}`,
      artistSpotifyUri: `spotify:artist:${index}`,
      position: 0,
    })),
  );

  const play = (id: string, track: 1 | 2, date: string) => ({
    id,
    userId,
    trackSpotifyUri: `spotify:track:${track}`,
    albumSpotifyUri: `spotify:album:${track}`,
    scrobbleDate: new Date(date),
  });

  await db.insert(scrobbles).values([
    play("jan-1", 1, "2026-01-05T10:00:00Z"),
    play("jan-2", 1, "2026-01-06T10:00:00Z"),
    play("jan-3", 1, "2026-01-07T10:00:00Z"),
    play("apr-1", 2, "2026-04-02T10:00:00Z"),
    play("apr-2", 2, "2026-04-03T10:00:00Z"),
    {
      id: "apr-loose",
      userId,
      trackName: "Loose Song",
      artistName: "Loose Artist",
      albumName: "Loose Album",
      scrobbleDate: new Date("2026-04-04T10:00:00Z"),
    },
  ]);

  return db;
}

describe("profile stats", () => {
  test("ranks lead artists with share and first and last play", async () => {
    await seed();

    const response = await get("getTop?username=alex&kind=artists");

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      kind: "artists",
      totalScrobbles: 6,
      distinct: 3,
      items: [
        {
          name: "First Artist",
          artist: null,
          spotifyUri: "spotify:artist:1",
          plays: 3,
          share: 0.5,
          firstPlayedAt: "2026-01-05T10:00:00.000Z",
          lastPlayedAt: "2026-01-07T10:00:00.000Z",
        },
        {
          name: "Second Artist",
          artist: null,
          spotifyUri: "spotify:artist:2",
          plays: 2,
          share: 0.3333,
          firstPlayedAt: "2026-04-02T10:00:00.000Z",
          lastPlayedAt: "2026-04-03T10:00:00.000Z",
        },
        {
          name: "Loose Artist",
          artist: null,
          spotifyUri: null,
          plays: 1,
          share: 0.1667,
          firstPlayedAt: "2026-04-04T10:00:00.000Z",
          lastPlayedAt: "2026-04-04T10:00:00.000Z",
        },
      ],
    });
  });

  test("limits rankings to plays inside since and until", async () => {
    await seed();

    const since = seconds("2026-04-01T00:00:00Z");
    const until = seconds("2026-04-04T00:00:00Z");
    const response = await get(`getTop?username=alex&kind=albums&since=${since}&until=${until}`);

    expect(await response.json()).toMatchObject({
      totalScrobbles: 2,
      distinct: 1,
      items: [{ name: "Album 2", artist: "Second Artist", plays: 2, share: 1 }],
    });
  });

  test("summarises the library envelope and taste", async () => {
    await seed();

    const response = await get("getSummary?username=alex");

    expect(await response.json()).toMatchObject({
      totalScrobbles: 6,
      firstScrobbleAt: "2026-01-05T10:00:00.000Z",
      lastScrobbleAt: "2026-04-04T10:00:00.000Z",
      distinct: { artists: 3, albums: 3, tracks: 3 },
      topArtists: [{ name: "First Artist" }, { name: "Second Artist" }, { name: "Loose Artist" }],
      topAlbums: [{ name: "Album 1" }, { name: "Album 2" }, { name: "Loose Album" }],
      topTracks: [
        { name: "Track 1", artist: "First Artist", plays: 3 },
        { name: "Track 2", artist: "Second Artist", plays: 2 },
        { name: "Loose Song", artist: "Loose Artist", plays: 1 },
      ],
    });
  });

  test("buckets plays by local month and reports empty runs as gaps", async () => {
    await seed();

    const response = await get("getTimeline?username=alex&bucket=month&timeZone=Europe/Athens");

    expect(await response.json()).toEqual({
      bucket: "month",
      timeZone: "Europe/Athens",
      totalScrobbles: 6,
      activeBuckets: 2,
      buckets: [
        { label: "2026-01", count: 3 },
        { label: "2026-02", count: 0 },
        { label: "2026-03", count: 0 },
        { label: "2026-04", count: 3 },
      ],
      gaps: [{ from: "2026-02", to: "2026-03", buckets: 2 }],
    });
  });

  test("starts weeks on Monday in the requested time zone", async () => {
    await seed();

    // 2026-01-05 is a Monday; 10:00 UTC on Sunday the 4th would still be Sunday.
    const until = seconds("2026-01-08T00:00:00Z");
    const response = await get(`getTimeline?username=alex&bucket=week&until=${until}`);

    expect(await response.json()).toMatchObject({
      buckets: [{ label: "2026-01-05", count: 3 }],
      gaps: [],
    });
  });

  test("rejects a timeline with more buckets than one call allows", async () => {
    const db = await seed();

    await db.insert(scrobbles).values({
      id: "old",
      userId,
      trackName: "Old Song",
      scrobbleDate: new Date("2024-01-01T00:00:00Z"),
    });

    expect((await get("getTimeline?username=alex&bucket=day")).status).toBe(400);
    expect((await get("getTimeline?username=alex&bucket=week")).status).toBe(200);
  });

  test("samples one play per time slice, repeatably for a seed", async () => {
    await seed();

    const first: unknown[] = await (await get("getSample?username=alex&size=50&seed=7")).json();
    const again: unknown[] = await (await get("getSample?username=alex&size=50&seed=7")).json();

    // Slices are about two days wide, so plays a day apart can share one, and
    // the first slice holds only January plays of Track 1.
    expect(first).toEqual(again);
    expect(first.length).toBeGreaterThan(1);
    expect(first[0]).toMatchObject({
      track: "Track 1",
      artist: "First Artist",
      album: "Album 1",
      spotifyUri: "spotify:track:1",
    });

    const one = await (await get("getSample?username=alex&size=1")).json();
    expect(one).toHaveLength(1);
  });

  test("rejects unbounded inputs and hides private profiles", async () => {
    const db = await seed();

    for (const path of [
      "getTop?username=alex&kind=artists&limit=51",
      "getTop?username=alex&kind=genres",
      "getTimeline?username=alex&bucket=hour",
      "getSample?username=alex&size=0",
      "getSummary?username=alex&since=-1",
    ]) {
      expect((await get(path)).status).toBe(400);
    }

    await db.update(users).set({ isPrivate: true }).where(eq(users.id, userId));

    expect((await get("getSummary?username=alex")).status).toBe(403);
    expect((await get("getSummary?username=missing")).status).toBe(404);
  });

  test("spends a stats budget smaller than the public-read one", async () => {
    await seed();

    const ip = "203.0.113.9";
    const periodMs = RATE_LIMITS.STATS_RATE_LIMIT.period * 1000;
    const remainingMs = periodMs - (Date.now() % periodMs);

    // Miniflare's wall-clock windows must leave room for every request.
    if (remainingMs < 5000) {
      await new Promise<void>((resolve) => {
        setTimeout(resolve, remainingMs);
      });
    }

    for (let count = 0; count < RATE_LIMITS.STATS_RATE_LIMIT.limit; count += 1) {
      expect((await get("getSample?username=alex&size=1", ip)).status).toBe(200);
    }

    expect((await get("getSample?username=alex&size=1", ip)).status).toBe(429);
  });
});
