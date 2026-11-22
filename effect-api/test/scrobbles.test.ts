import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Effect, Layer, Schema } from "effect";
import { describe, expect, test } from "vitest";

import { countScrobblesByMonth, findRecentScrobblesByUserId } from "../src/db/queries/scrobbles.ts";
import {
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";
import { createDatabase, Db } from "../src/db/service.ts";
import { Scrobbles } from "../src/scrobbles/service.ts";
import { Users } from "../src/users/service.ts";
import worker from "../src/worker.ts";
import { baseUrl, signIn } from "./session.ts";

const userId = "V1StGXR8_Z5jdHi6B-myT";
const now = new Date("2026-11-11T12:00:00.000Z");

async function seed() {
  const db = createDatabase(env.DB);

  await db.insert(users).values({
    id: userId,
    username: "alex",
    name: "Alex",
    email: "alex@example.com",
    avatarUrl: "https://example.com/alex.jpg",
    updatedAt: now,
    onboarded: true,
  });

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

  // Insert the second artist first so the route's sort is observable.
  await db.insert(trackArtists).values([
    { trackSpotifyUri: "spotify:track:1", artistSpotifyUri: "spotify:artist:2", position: 1 },
    { trackSpotifyUri: "spotify:track:1", artistSpotifyUri: "spotify:artist:1", position: 0 },
  ]);

  await db.insert(albumArtists).values({
    albumSpotifyUri: "spotify:album:1",
    artistSpotifyUri: "spotify:artist:1",
    position: 0,
  });

  await db.insert(scrobbles).values([
    {
      id: "scrobble-old",
      userId,
      trackSpotifyUri: "spotify:track:1",
      albumSpotifyUri: "spotify:album:1",
      scrobbleDate: new Date("2026-11-10T12:00:00.000Z"),
    },
    {
      id: "scrobble-new",
      userId,
      trackSpotifyUri: "spotify:track:1",
      albumSpotifyUri: "spotify:album:1",
      scrobbleDate: new Date("2026-11-11T12:00:00.000Z"),
    },
  ]);

  return { db };
}

function runScrobbles<A, E>(effect: Effect.Effect<A, E, Scrobbles>) {
  const dbLayer = Db.layerFromBinding(env.DB);
  const usersLayer = Users.layer.pipe(Layer.provide(dbLayer));
  const layer = Scrobbles.layer.pipe(Layer.provide(Layer.mergeAll(dbLayer, usersLayer)));

  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

describe("scrobble service visibility and validation", () => {
  test("hides a private profile's scrobbles and months from other users and the public feed", async () => {
    const { db } = await seed();

    await db.update(users).set({ isPrivate: true }).where(eq(users.id, userId));

    const otherRecent = await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;

        return yield* service
          .getRecent({ username: "alex", offset: 0, limit: 8 }, "other")
          .pipe(Effect.flip);
      }),
    );

    expect(otherRecent._tag).toBe("ProfilePrivateError");

    const otherMonths = await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;

        return yield* service
          .getMonths({ username: "alex", timeZone: "UTC" }, "other")
          .pipe(Effect.flip);
      }),
    );

    expect(otherMonths._tag).toBe("ProfilePrivateError");

    const ownerRecent = await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;

        return yield* service.getRecent({ username: "alex", offset: 0, limit: 8 }, userId);
      }),
    );

    expect(ownerRecent).toHaveLength(2);

    const feed = await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;

        return yield* service.getPublicFeed({ limit: 20 });
      }),
    );

    expect(feed).toEqual({ items: [], nextCursor: null });
  });

  test("rejects invalid cursor in service and invalid query params on routes", async () => {
    const invalidCursor = await runScrobbles(
      Effect.gen(function* () {
        const service = yield* Scrobbles;

        return yield* service.getPublicFeed({ limit: 20, cursor: "invalid" }).pipe(Effect.flip);
      }),
    );

    expect(invalidCursor._tag).toBe("InvalidCursorError");

    const responses = await Promise.all([
      worker.fetch(
        new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0&limit=9`),
        env,
      ),
      worker.fetch(
        new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=-1`),
        env,
      ),
      worker.fetch(
        new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=1.5`),
        env,
      ),
      worker.fetch(
        new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0&limit=0`),
        env,
      ),
      worker.fetch(
        new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0&before=-1`),
        env,
      ),
      worker.fetch(new Request(`${baseUrl}/api/scrobble/getRecent?username=&offset=0`), env),
      worker.fetch(
        new Request(`${baseUrl}/api/scrobble/getMonths?username=alex&timeZone=invalid`),
        env,
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(400);
    }
  });
});

describe("scrobble queries", () => {
  test("returns recent scrobbles with their artists in newest-first order", async () => {
    const { db } = await seed();

    const recent = await findRecentScrobblesByUserId(db, userId, { offset: 0, limit: 8 });

    expect(recent.map((scrobble) => scrobble.id)).toEqual(["scrobble-new", "scrobble-old"]);

    const [scrobble] = recent;
    expect(scrobble?.track?.name).toBe("A Track");
    expect(scrobble?.track?.artists).toHaveLength(2);
    expect(scrobble?.track?.artists.map(({ name }) => name)).toEqual([
      "First Artist",
      "Second Artist",
    ]);
    expect(scrobble?.album?.name).toBe("An Album");
    expect(scrobble?.album?.artists[0]?.name).toBe("First Artist");
  });

  test("projects unlinked scrobbles from stored fallback names and cover art", async () => {
    const { db } = await seed();

    await db.insert(scrobbles).values({
      id: "scrobble-unlinked",
      userId,
      trackName: "Ghost Track",
      artistName: "Unknown Singer",
      albumName: "Ghost Album",
      coverArtUrl: "https://example.com/ghost.jpg",
      scrobbleDate: new Date("2026-11-12T12:00:00.000Z"),
    });

    const recent = await findRecentScrobblesByUserId(db, userId, { offset: 0, limit: 1 });
    const [scrobble] = recent;

    expect(scrobble?.id).toBe("scrobble-unlinked");
    expect(scrobble?.track).toEqual({
      name: "Ghost Track",
      imageUrl: "https://example.com/ghost.jpg",
      spotifyUri: undefined,
      artists: [{ name: "Unknown Singer", spotifyUri: undefined }],
    });
    expect(scrobble?.album).toEqual({
      name: "Ghost Album",
      imageUrl: "https://example.com/ghost.jpg",
      spotifyUri: undefined,
      artists: [],
    });
  });

  test("returns only scrobbles played before the given time", async () => {
    const { db } = await seed();

    const recent = await findRecentScrobblesByUserId(db, userId, {
      before: new Date("2026-11-11T00:00:00.000Z"),
      offset: 0,
      limit: 8,
    });

    expect(recent.map((scrobble) => scrobble.id)).toEqual(["scrobble-old"]);
  });

  test("counts scrobbles per month in the viewer's time zone", async () => {
    const { db } = await seed();

    await db.insert(scrobbles).values([
      {
        id: "scrobble-october",
        userId,
        trackSpotifyUri: "spotify:track:1",
        albumSpotifyUri: "spotify:album:1",
        scrobbleDate: new Date("2026-10-31T23:30:00.000Z"),
      },
      {
        // 00:30 on 1 October in Athens, which is on summer time (UTC+3) then.
        id: "scrobble-summer-time",
        userId,
        trackSpotifyUri: "spotify:track:1",
        albumSpotifyUri: "spotify:album:1",
        scrobbleDate: new Date("2026-09-30T21:30:00.000Z"),
      },
    ]);

    expect(await countScrobblesByMonth(db, userId, { timeZone: "UTC" })).toEqual([
      { month: "2026-11", count: 2 },
      { month: "2026-10", count: 1 },
      { month: "2026-09", count: 1 },
    ]);
    expect(await countScrobblesByMonth(db, userId, { timeZone: "Europe/Athens" })).toEqual([
      { month: "2026-11", count: 3 },
      { month: "2026-10", count: 1 },
    ]);
  });

  test("starts a month after a DST gap that skips its midnight", async () => {
    const { db } = await seed();

    // Havana skipped 1 April 2012 00:00-01:00, so April starts at 01:00 CDT
    // (05:00 UTC) and 00:30 UTC-5 is still the end of March.
    await db.insert(scrobbles).values([
      {
        id: "scrobble-march",
        userId,
        trackSpotifyUri: "spotify:track:1",
        albumSpotifyUri: "spotify:album:1",
        scrobbleDate: new Date("2012-04-01T04:30:00.000Z"),
      },
      {
        id: "scrobble-april",
        userId,
        trackSpotifyUri: "spotify:track:1",
        albumSpotifyUri: "spotify:album:1",
        scrobbleDate: new Date("2012-04-01T05:30:00.000Z"),
      },
    ]);

    const months = await countScrobblesByMonth(db, userId, { timeZone: "America/Havana" });

    expect(months.slice(-2)).toEqual([
      { month: "2012-04", count: 1 },
      { month: "2012-03", count: 1 },
    ]);
  });
});

describe("scrobble routes", () => {
  test("serves the monthly scrobble counts of a public profile", async () => {
    await seed();

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/scrobble/getMonths?username=alex&timeZone=Europe/Athens`),
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ month: "2026-11", count: 2 }]);
  });

  test("serves the scrobbles of a public profile without a session", async () => {
    await seed();

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0`),
      env,
    );

    expect(response.status).toBe(200);

    const parsed = Schema.decodeUnknownSync(Schema.Array(Schema.Struct({ id: Schema.String })))(
      await response.json(),
    );

    expect(parsed.map(({ id }) => id)).toEqual(["scrobble-new", "scrobble-old"]);
  });

  test("hides a private profile's scrobbles from anonymous visitors and other users", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn({ id: "spotify-other", email: "other@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true, isPrivate: true })
      .where(eq(users.id, owner.userId));

    const responses = await Promise.all([
      worker.fetch(new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0`), env),
      worker.fetch(
        new Request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0`, {
          headers: { cookie: other.cookie },
        }),
        env,
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Profile is private" });
    }
  });
});
