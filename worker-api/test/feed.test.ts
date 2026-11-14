import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import z from "zod";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import {
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";
import { createTestEnv } from "./harness.ts";

const userA = "V1StGXR8_Z5jdHi6B-myT";
const userB = "V1StGXR8_Z5jdHi6B-myU";
const userC = "V1StGXR8_Z5jdHi6B-myV";
const userD = "V1StGXR8_Z5jdHi6B-myW";

const ids = {
  a1: `${"a".repeat(31)}1`,
  a2: `${"a".repeat(31)}2`,
  a3: `${"a".repeat(31)}3`,
  b1: `${"b".repeat(31)}1`,
  c1: `${"c".repeat(31)}1`,
  d1: `${"d".repeat(31)}1`,
};

const now = new Date("2026-11-11T12:00:00.000Z");

const feedResponse = z.object({
  items: z.array(
    z.object({
      id: z.string(),
      scrobbleDate: z.string(),
      user: z.object({
        username: z.string(),
        name: z.string(),
        avatarUrl: z.string().nullable(),
      }),
      track: z.object({
        name: z.string(),
        imageUrl: z.string(),
        artists: z.array(z.string()),
      }),
    }),
  ),
  nextCursor: z.string().nullable(),
});

async function seed() {
  const env = createTestEnv();
  const db = createDatabase(env.DB);

  await db.insert(users).values([
    {
      id: userA,
      username: "alex",
      name: "Alex",
      email: "alex@example.com",
      avatarUrl: "https://example.com/alex.jpg",
      updatedAt: now,
      onboarded: true,
    },
    {
      id: userB,
      username: "sam",
      name: "Sam",
      email: "sam@example.com",
      updatedAt: now,
      onboarded: true,
    },
    {
      id: userC,
      username: "hidden",
      name: "Hidden",
      email: "hidden@example.com",
      updatedAt: now,
      onboarded: true,
      isPrivate: true,
    },
    {
      id: userD,
      username: "new",
      name: "New",
      email: "new@example.com",
      updatedAt: now,
      onboarded: false,
    },
  ]);

  await db.insert(artists).values([
    { spotifyUri: "spotify:artist:1", name: "First Artist" },
    { spotifyUri: "spotify:artist:2", name: "Second Artist" },
  ]);

  await db.insert(albums).values({
    spotifyUri: "spotify:album:1",
    name: "An Album",
    releaseDate: "2026",
    totalTracks: 1,
    albumType: "album",
    imageUrl: "https://example.com/album.jpg",
  });

  await db.insert(tracks).values({
    spotifyUri: "spotify:track:1",
    name: "A Track",
    trackNumber: 1,
    releaseDate: "2026",
    imageUrl: "https://example.com/track.jpg",
    duration: 180_000,
  });

  // Insert the second artist first so the feed's order is observable.
  await db.insert(trackArtists).values([
    { trackSpotifyUri: "spotify:track:1", artistSpotifyUri: "spotify:artist:2", position: 1 },
    { trackSpotifyUri: "spotify:track:1", artistSpotifyUri: "spotify:artist:1", position: 0 },
  ]);

  await db.insert(albumArtists).values({
    albumSpotifyUri: "spotify:album:1",
    artistSpotifyUri: "spotify:artist:1",
    position: 0,
  });

  const scrobble = (id: string, userId: string, at: string) => ({
    id,
    userId,
    trackSpotifyUri: "spotify:track:1",
    albumSpotifyUri: "spotify:album:1",
    scrobbleDate: new Date(at),
  });

  await db
    .insert(scrobbles)
    .values([
      scrobble(ids.a1, userA, "2026-11-11T12:00:00.000Z"),
      scrobble(ids.a2, userB, "2026-11-11T12:00:00.000Z"),
      scrobble(ids.a3, userA, "2026-11-11T11:00:00.000Z"),
      scrobble(ids.b1, userB, "2026-11-11T10:00:00.000Z"),
      scrobble(ids.c1, userC, "2026-11-11T13:00:00.000Z"),
      scrobble(ids.d1, userD, "2026-11-11T14:00:00.000Z"),
    ]);

  return { env, db };
}

describe("public feed", () => {
  test("returns public scrobbles with their listener and artists without a session", async () => {
    const { env } = await seed();

    const response = await createApp().request("/api/feed", undefined, env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");

    const body = feedResponse.parse(await response.json());

    expect(body.items.map(({ id }) => id)).toEqual([ids.a2, ids.a1, ids.a3, ids.b1]);
    expect(body.items[0]?.user).toEqual({
      username: "sam",
      name: "Sam",
      avatarUrl: null,
    });
    expect(body.items[0]?.track).toEqual({
      name: "A Track",
      imageUrl: "https://example.com/track.jpg",
      artists: ["First Artist", "Second Artist"],
    });
    expect(body.nextCursor).toBeNull();
  });

  test("paginates with a keyset cursor without duplicates", async () => {
    const { env } = await seed();
    const app = createApp();

    const first = await app.request("/api/feed?limit=2", undefined, env);
    const firstBody = feedResponse.parse(await first.json());

    expect(first.headers.get("Cache-Control")).toContain("max-age=30");
    expect(firstBody.items.map(({ id }) => id)).toEqual([ids.a2, ids.a1]);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await app.request(
      `/api/feed?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      undefined,
      env,
    );

    const secondBody = feedResponse.parse(await second.json());

    expect(second.headers.get("Cache-Control")).toContain("max-age=300");
    expect(secondBody.items.map(({ id }) => id)).toEqual([ids.a3, ids.b1]);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("drops a user as soon as the profile becomes private", async () => {
    const { env, db } = await seed();

    await db.update(users).set({ isPrivate: true }).where(eq(users.id, userA));

    const response = await createApp().request("/api/feed", undefined, env);
    const body = feedResponse.parse(await response.json());

    expect(body.items.map(({ id }) => id)).toEqual([ids.a2, ids.b1]);
  });

  test("rejects an invalid cursor and a limit above fifty", async () => {
    const { env } = await seed();
    const app = createApp();

    const responses = await Promise.all([
      app.request("/api/feed?cursor=not-a-cursor", undefined, env),
      app.request("/api/feed?limit=51", undefined, env),
      app.request("/api/feed?limit=0", undefined, env),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });
});

describe("cache policy", () => {
  test("makes every response private unless the route opts in", async () => {
    const { env } = await seed();
    const app = createApp();

    const responses = await Promise.all([
      app.request("/api/user/me", undefined, env),
      app.request("/api/user/byUsername?username=alex", undefined, env),
      app.request("/api/scrobble/getRecent?username=alex&offset=0", undefined, env),
      app.request("/does-not-exist", undefined, env),
    ]);

    for (const response of responses) {
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  test("keeps the feed public", async () => {
    const { env } = await seed();

    const response = await createApp().request("/api/feed", undefined, env);

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
  });
});
