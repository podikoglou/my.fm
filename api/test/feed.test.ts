import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import worker from "../src/worker.ts";
import { baseUrl } from "./session.ts";
import { insertRows, updateRows } from "./d1.ts";

const userA = "V1StGXR8_Z5jdHi6B-myT";
const userB = "V1StGXR8_Z5jdHi6B-myU";
const userC = "V1StGXR8_Z5jdHi6B-myV";
const userD = "V1StGXR8_Z5jdHi6B-myW";
const userE = "V1StGXR8_Z5jdHi6B-myX";

const ids = {
  a1: `${"a".repeat(31)}1`,
  a2: `${"a".repeat(31)}2`,
  a3: `${"a".repeat(31)}3`,
  b1: `${"b".repeat(31)}1`,
  c1: `${"c".repeat(31)}1`,
  d1: `${"d".repeat(31)}1`,
  e1: `${"e".repeat(31)}1`,
};

const now = new Date("2026-11-11T12:00:00.000Z");

const FeedResponseSchema = Schema.Struct({
  items: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      scrobbleDate: Schema.String,
      user: Schema.Struct({
        username: Schema.String,
        name: Schema.String,
        avatarUrl: Schema.NullOr(Schema.String),
      }),
      track: Schema.Struct({
        name: Schema.String,
        imageUrl: Schema.String,
        spotifyUri: Schema.String,
        artists: Schema.Array(
          Schema.Struct({
            name: Schema.String,
            spotifyUri: Schema.String,
          }),
        ),
      }),
      album: Schema.Struct({
        name: Schema.String,
        spotifyUri: Schema.String,
      }),
    }),
  ),
  nextCursor: Schema.NullOr(Schema.String),
});

const decodeFeedResponse = Schema.decodeUnknownSync(FeedResponseSchema);

async function seed() {
  await insertRows(env.DB, "users", [
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

  await insertRows(env.DB, "artists", [
    { spotifyUri: "spotify:artist:1", name: "First Artist" },
    { spotifyUri: "spotify:artist:2", name: "Second Artist" },
  ]);

  await insertRows(env.DB, "albums", {
    spotifyUri: "spotify:album:1",
    name: "An Album",
    releaseDate: "2026",
    totalTracks: 1,
    albumType: "album",
    imageUrl: "https://example.com/album.jpg",
  });

  await insertRows(env.DB, "tracks", {
    spotifyUri: "spotify:track:1",
    name: "A Track",
    trackNumber: 1,
    releaseDate: "2026",
    imageUrl: "https://example.com/track.jpg",
    duration: 180_000,
  });

  // Insert the second artist first so the feed's order is observable.
  await insertRows(env.DB, "track_artists", [
    { trackSpotifyUri: "spotify:track:1", artistSpotifyUri: "spotify:artist:2", position: 1 },
    { trackSpotifyUri: "spotify:track:1", artistSpotifyUri: "spotify:artist:1", position: 0 },
  ]);

  await insertRows(env.DB, "album_artists", {
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

  await insertRows(env.DB, "scrobbles", [
    scrobble(ids.a1, userA, "2026-11-11T12:00:00.000Z"),
    scrobble(ids.a2, userB, "2026-11-11T12:00:00.000Z"),
    scrobble(ids.a3, userA, "2026-11-11T11:00:00.000Z"),
    scrobble(ids.b1, userB, "2026-11-11T10:00:00.000Z"),
    scrobble(ids.c1, userC, "2026-11-11T13:00:00.000Z"),
    scrobble(ids.d1, userD, "2026-11-11T14:00:00.000Z"),
  ]);
}

describe("public feed", () => {
  test("returns public scrobbles with their listener and artists without a session", async () => {
    await seed();

    const response = await worker.fetch(new Request(`${baseUrl}/api/feed`), env);

    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("public");

    const body = decodeFeedResponse(await response.json());

    expect(body.items.map(({ id }) => id)).toEqual([ids.a2, ids.a1, ids.a3, ids.b1]);
    expect(body.items[0]?.user).toEqual({
      username: "sam",
      name: "Sam",
      avatarUrl: null,
    });
    expect(body.items[0]?.track).toEqual({
      name: "A Track",
      imageUrl: "https://example.com/track.jpg",
      spotifyUri: "spotify:track:1",
      artists: [
        { name: "First Artist", spotifyUri: "spotify:artist:1" },
        { name: "Second Artist", spotifyUri: "spotify:artist:2" },
      ],
    });
    expect(body.items[0]?.album).toEqual({
      name: "An Album",
      spotifyUri: "spotify:album:1",
    });
    expect(body.nextCursor).toBeNull();
  });

  test("includes onboarded public users with an empty name", async () => {
    await seed();
    await insertRows(env.DB, "users", {
      id: userE,
      username: "empty-name",
      name: "",
      email: "empty-name@example.com",
      updatedAt: now,
      onboarded: true,
      isPrivate: false,
    });
    await insertRows(env.DB, "scrobbles", {
      id: ids.e1,
      userId: userE,
      trackSpotifyUri: "spotify:track:1",
      albumSpotifyUri: "spotify:album:1",
      scrobbleDate: now,
    });

    const response = await worker.fetch(new Request(`${baseUrl}/api/feed`), env);
    const body = decodeFeedResponse(await response.json());
    const item = body.items.find(({ id }) => id === ids.e1);

    expect(item?.user).toEqual({
      username: "empty-name",
      name: "",
      avatarUrl: null,
    });
  });

  test("paginates with a keyset cursor without duplicates", async () => {
    await seed();

    const first = await worker.fetch(new Request(`${baseUrl}/api/feed?limit=2`), env);
    const firstBody = decodeFeedResponse(await first.json());

    expect(first.headers.get("Cache-Control")).toContain("max-age=30");
    expect(firstBody.items.map(({ id }) => id)).toEqual([ids.a2, ids.a1]);
    expect(firstBody.nextCursor).not.toBeNull();

    const second = await worker.fetch(
      new Request(
        `${baseUrl}/api/feed?limit=2&cursor=${encodeURIComponent(firstBody.nextCursor ?? "")}`,
      ),
      env,
    );

    const secondBody = decodeFeedResponse(await second.json());

    expect(second.headers.get("Cache-Control")).toContain("max-age=300");
    expect(secondBody.items.map(({ id }) => id)).toEqual([ids.a3, ids.b1]);
    expect(secondBody.nextCursor).toBeNull();
  });

  test("drops a user as soon as the profile becomes private", async () => {
    await seed();

    await updateRows(env.DB, "users", { isPrivate: true }, { id: userA });

    const response = await worker.fetch(new Request(`${baseUrl}/api/feed`), env);
    const body = decodeFeedResponse(await response.json());

    expect(body.items.map(({ id }) => id)).toEqual([ids.a2, ids.b1]);
  });

  test("rejects an invalid cursor and a limit above fifty", async () => {
    await seed();

    const responses = await Promise.all([
      worker.fetch(new Request(`${baseUrl}/api/feed?cursor=not-a-cursor`), env),
      worker.fetch(new Request(`${baseUrl}/api/feed?limit=51`), env),
      worker.fetch(new Request(`${baseUrl}/api/feed?limit=0`), env),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });
});

describe("cache policy", () => {
  test("makes every response private unless the route opts in", async () => {
    await seed();

    const responses = await Promise.all([
      worker.fetch(new Request(`${baseUrl}/api/user/me`), env),
      worker.fetch(new Request(`${baseUrl}/api/user/byUsername?username=alex`), env),
      worker.fetch(new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0`), env),
      worker.fetch(new Request(`${baseUrl}/does-not-exist`), env),
    ]);

    for (const response of responses) {
      expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    }
  });

  test("keeps the feed public", async () => {
    await seed();

    const response = await worker.fetch(new Request(`${baseUrl}/api/feed`), env);

    expect(response.headers.get("Cache-Control")).toBe("public, max-age=30");
  });
});
