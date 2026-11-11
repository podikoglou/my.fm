import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import { findRecentScrobblesByUserId } from "../src/db/queries/scrobbles.ts";
import {
  findUserById,
  findUserByIdPublic,
  findUserByUsernamePublic,
  onboardUser,
} from "../src/db/queries/users.ts";
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

const userId = "user-1";
const now = new Date("2026-11-11T12:00:00.000Z");

async function seed() {
  const env = createTestEnv();
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

  return { env, db };
}

describe("user queries", () => {
  test("reads the application user by id", async () => {
    const { db } = await seed();

    const user = await findUserById(db, userId);

    expect(user?.email).toBe("alex@example.com");
    expect(user?.onboarded).toBe(true);
  });

  test("limits public lookups to the public columns", async () => {
    const { db } = await seed();

    const byUsername = await findUserByUsernamePublic(db, "alex");
    const byId = await findUserByIdPublic(db, userId);

    expect(byUsername).toEqual({
      id: userId,
      username: "alex",
      name: "Alex",
      avatarUrl: "https://example.com/alex.jpg",
    });
    expect(byId).toEqual(byUsername);
  });

  test("marks the user as onboarded", async () => {
    const { db } = await seed();

    await onboardUser(db, userId, { username: "alex_new", name: "Alex New" });
    const user = await findUserById(db, userId);

    expect(user?.username).toBe("alex_new");
    expect(user?.name).toBe("Alex New");
    expect(user?.onboarded).toBe(true);
  });
});

describe("scrobble queries", () => {
  test("returns recent scrobbles with their artists in newest-first order", async () => {
    const { db } = await seed();

    const recent = await findRecentScrobblesByUserId(db, userId, { offset: 0, limit: 8 });

    expect(recent.map((scrobble) => scrobble.id)).toEqual(["scrobble-new", "scrobble-old"]);

    const [scrobble] = recent;
    expect(scrobble?.track.name).toBe("A Track");
    expect(scrobble?.track.trackArtists).toHaveLength(2);
    expect(scrobble?.track.trackArtists.map(({ artist }) => artist.name)).toEqual([
      "First Artist",
      "Second Artist",
    ]);
    expect(scrobble?.album.name).toBe("An Album");
    expect(scrobble?.album.albumArtists[0]?.artist.name).toBe("First Artist");
  });

  test("applies the offset and limit", async () => {
    const { db } = await seed();

    const recent = await findRecentScrobblesByUserId(db, userId, { offset: 1, limit: 1 });

    expect(recent.map((scrobble) => scrobble.id)).toEqual(["scrobble-old"]);
  });
});

describe("authenticated routes", () => {
  test("rejects requests without a session", async () => {
    const env = createTestEnv();
    const app = createApp();

    const requests = [
      app.request("/user/me", undefined, env),
      app.request("/user/byUsername?username=alex", undefined, env),
      app.request("/user/byId?id=user-1", undefined, env),
      app.request("/user/onboard", { method: "PUT" }, env),
      app.request("/scrobble/getRecent?username=alex&offset=0", undefined, env),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
      // The error handler forwards HTTPException's empty message.
      expect(await response.json()).toEqual({ error: "" });
    }
  });
});
