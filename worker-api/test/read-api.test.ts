import { describe, expect, test } from "bun:test";
import { eq } from "drizzle-orm";
import z from "zod";

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
import { baseUrl, createTestEnv, replaceFetch } from "./harness.ts";

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
      isPrivate: false,
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
      app.request("/api/user/me", undefined, env),
      app.request("/api/user/byUsername?username=alex", undefined, env),
      app.request("/api/user/byId?id=user-1", undefined, env),
      app.request("/api/user/onboard", { method: "PUT" }, env),
      app.request("/api/user/settings", { method: "PATCH" }, env),
      app.request("/api/scrobble/getRecent?username=alex&offset=0", undefined, env),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
      // The error handler forwards HTTPException's empty message.
      expect(await response.json()).toEqual({ error: "" });
    }
  });

  test("does not serve the client routes outside /api", async () => {
    const response = await createApp().request("/user/me", undefined, createTestEnv());

    expect(response.status).toBe(404);
  });
});

async function signIn(
  env: ReturnType<typeof createTestEnv>,
  spotify: { id: string; email: string },
): Promise<{ cookie: string; userId: string }> {
  const app = createApp();

  const restoreFetch = replaceFetch(async (input) => {
    const url = input instanceof Request ? input.url : input.toString();

    if (url.startsWith("https://accounts.spotify.com/api/token")) {
      return Response.json({
        access_token: "access-token",
        expires_in: 3600,
        refresh_token: "refresh-token",
        scope: "user-read-email",
        token_type: "Bearer",
      });
    }

    if (url.startsWith("https://api.spotify.com/v1/me")) {
      return Response.json({
        display_name: "Test User",
        email: spotify.email,
        id: spotify.id,
        images: [],
      });
    }

    throw new Error(`Unexpected fetch: ${url}`);
  });

  try {
    const signInResponse = await app.request(
      `${baseUrl}/api/auth/sign-in/social`,
      {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ provider: "spotify", callbackURL: `${baseUrl}/onboard` }),
      },
      env,
    );

    const { url } = z.object({ url: z.string() }).parse(await signInResponse.json());
    const state = new URL(url).searchParams.get("state");
    const cookies = signInResponse.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);

    const callback = await app.request(
      `${baseUrl}/api/auth/callback/spotify?code=fake-code&state=${state}`,
      { headers: { cookie: cookies.join("; ") } },
      env,
    );

    expect(callback.status).toBe(302);

    const sessionCookies = callback.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);

    const user = await createDatabase(env.DB).query.users.findFirst({
      where: { email: spotify.email },
    });

    if (!user) {
      throw new Error("The Spotify callback did not create a user");
    }

    return { cookie: sessionCookies.join("; "), userId: user.id };
  } finally {
    restoreFetch();
  }
}

describe("settings routes", () => {
  test("returns the privacy setting on the current user", async () => {
    const env = createTestEnv();
    const owner = await signIn(env, { id: "spotify-owner", email: "owner@example.com" });

    const response = await createApp().request(
      `${baseUrl}/api/user/me`,
      { headers: { cookie: owner.cookie } },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: owner.userId,
      username: expect.any(String),
      name: "Test User",
      email: "owner@example.com",
      avatarUrl: null,
      onboarded: null,
      isPrivate: false,
    });
  });

  test("updates the privacy setting for the session user", async () => {
    const env = createTestEnv();
    const owner = await signIn(env, { id: "spotify-owner", email: "owner@example.com" });

    const response = await createApp().request(
      `${baseUrl}/api/user/settings`,
      {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ isPrivate: true }),
      },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ isPrivate: true });

    const user = await createDatabase(env.DB).query.users.findFirst({
      where: { id: owner.userId },
    });

    expect(user?.isPrivate).toBe(true);
  });

  test("rejects an invalid privacy value", async () => {
    const env = createTestEnv();
    const owner = await signIn(env, { id: "spotify-owner", email: "owner@example.com" });

    const response = await createApp().request(
      `${baseUrl}/api/user/settings`,
      {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ isPrivate: "yes" }),
      },
      env,
    );

    expect(response.status).toBe(400);
  });

  test("hides the profile from other users after the owner makes it private", async () => {
    const env = createTestEnv();
    const owner = await signIn(env, { id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn(env, { id: "spotify-other", email: "other@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true })
      .where(eq(users.id, owner.userId));

    const app = createApp();

    const settings = await app.request(
      `${baseUrl}/api/user/settings`,
      {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ isPrivate: true }),
      },
      env,
    );

    expect(settings.status).toBe(200);

    const profile = await app.request(
      `${baseUrl}/api/user/byUsername?username=alex`,
      { headers: { cookie: other.cookie } },
      env,
    );

    expect(profile.status).toBe(403);
    expect(await profile.json()).toEqual({ error: "Profile is private" });
  });
});

describe("profile visibility", () => {
  test("hides a private profile and its scrobbles from other users", async () => {
    const env = createTestEnv();
    const owner = await signIn(env, { id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn(env, { id: "spotify-other", email: "other@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true, isPrivate: true })
      .where(eq(users.id, owner.userId));

    const app = createApp();
    const headers = { cookie: other.cookie };

    const requests = [
      app.request(`${baseUrl}/api/user/byUsername?username=alex`, { headers }, env),
      app.request(`${baseUrl}/api/user/byId?id=${owner.userId}`, { headers }, env),
      app.request(`${baseUrl}/api/scrobble/getRecent?username=alex&offset=0`, { headers }, env),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Profile is private" });
    }
  });

  test("shows a private profile to its owner", async () => {
    const env = createTestEnv();
    const owner = await signIn(env, { id: "spotify-owner", email: "owner@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true, isPrivate: true })
      .where(eq(users.id, owner.userId));

    const response = await createApp().request(
      `${baseUrl}/api/user/byUsername?username=alex`,
      { headers: { cookie: owner.cookie } },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: owner.userId,
      username: "alex",
      name: "Alex",
      avatarUrl: null,
    });
  });

  test("shows a public profile to other users", async () => {
    const env = createTestEnv();
    const owner = await signIn(env, { id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn(env, { id: "spotify-other", email: "other@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true })
      .where(eq(users.id, owner.userId));

    const response = await createApp().request(
      `${baseUrl}/api/user/byUsername?username=alex`,
      { headers: { cookie: other.cookie } },
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      id: owner.userId,
      username: "alex",
      name: "Alex",
      avatarUrl: null,
    });
  });
});
