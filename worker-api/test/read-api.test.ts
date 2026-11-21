import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { http } from "msw";
import { describe, expect, test } from "vitest";
import z from "zod";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import { countScrobblesByMonth, findRecentScrobblesByUserId } from "../src/db/queries/scrobbles.ts";
import { findUserByIdPublic, findUserByUsernamePublic } from "../src/db/queries/users.ts";
import {
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  users,
} from "../src/db/schema.ts";
import { getPublicFeed } from "../src/services/feed-reads.ts";
import { getRecentScrobbles, getScrobbleMonths } from "../src/services/scrobble-reads.ts";
import { getMeForMcp } from "../src/services/user-reads.ts";
import { viewProfileByUsername } from "../src/visibility.ts";
import { network } from "./network.ts";

const baseUrl = "http://app.test";

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

  return { env, db };
}

describe("user queries", () => {
  test("resolves a private profile for its owner and hides it from every read surface", async () => {
    const { db } = await seed();

    await db.update(users).set({ isPrivate: true }).where(eq(users.id, userId));
    expect(await getMeForMcp(db, userId)).toEqual({
      data: { id: userId, username: "alex", name: "Alex", onboarded: true, isPrivate: true },
    });
    expect(await viewProfileByUsername(db, "alex", userId)).toEqual({
      data: {
        id: userId,
        username: "alex",
        name: "Alex",
        avatarUrl: "https://example.com/alex.jpg",
      },
    });
    expect(await viewProfileByUsername(db, "alex", "other")).toEqual({
      error: "Profile is private",
      status: 403,
    });
    expect(await getRecentScrobbles(db, { username: "alex", offset: 0 }, "other")).toEqual({
      error: "Profile is private",
      status: 403,
    });
    expect(await getScrobbleMonths(db, { username: "alex" }, "other")).toEqual({
      error: "Profile is private",
      status: 403,
    });
    const recent = await getRecentScrobbles(db, { username: "alex", offset: 0 }, userId);
    expect(recent.data).toHaveLength(2);
    expect(await getPublicFeed(db, {})).toEqual({ data: { items: [], nextCursor: null } });
  });

  test("reports missing users and validates service inputs without a route", async () => {
    const db = createDatabase(env.DB);
    expect(await getMeForMcp(db, userId)).toEqual({ error: "User not found", status: 404 });
    expect(await viewProfileByUsername(db, "missing")).toEqual({
      error: "User not found",
      status: 404,
    });
    await expect(
      getRecentScrobbles(db, { username: "alex", offset: 0, limit: 9 }),
    ).rejects.toThrow();
    await expect(
      getScrobbleMonths(db, { username: "alex", timeZone: "invalid" }),
    ).rejects.toThrow();
    await expect(getPublicFeed(db, { limit: 51 })).rejects.toThrow();
    expect(await getPublicFeed(db, { cursor: "invalid" })).toEqual({
      error: "Invalid cursor",
      status: 400,
    });
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

describe("anonymous reads", () => {
  test("serves a public profile without a session", async () => {
    const { env } = await seed();
    const app = createApp();

    const byUsername = await app.request("/api/user/byUsername?username=alex", undefined, env);
    const byId = await app.request(`/api/user/byId?id=${userId}`, undefined, env);

    expect(byUsername.status).toBe(200);
    expect(byId.status).toBe(200);

    const profile = {
      id: userId,
      username: "alex",
      name: "Alex",
      avatarUrl: "https://example.com/alex.jpg",
    };

    expect(await byUsername.json()).toEqual(profile);
    expect(await byId.json()).toEqual(profile);
  });

  test("serves the monthly scrobble counts of a public profile", async () => {
    const { env } = await seed();

    const response = await createApp().request(
      "/api/scrobble/getMonths?username=alex&timeZone=Europe/Athens",
      undefined,
      env,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual([{ month: "2026-11", count: 2 }]);
  });

  test("serves the scrobbles of a public profile without a session", async () => {
    const { env } = await seed();

    const response = await createApp().request(
      "/api/scrobble/getRecent?username=alex&offset=0",
      undefined,
      env,
    );

    expect(response.status).toBe(200);

    const scrobbles = z.array(z.object({ id: z.string() })).parse(await response.json());

    expect(scrobbles.map(({ id }) => id)).toEqual(["scrobble-new", "scrobble-old"]);
  });

  test("hides a private profile and its scrobbles from an anonymous visitor", async () => {
    const { env, db } = await seed();

    await db.update(users).set({ isPrivate: true }).where(eq(users.id, userId));

    const app = createApp();

    const responses = await Promise.all([
      app.request("/api/user/byUsername?username=alex", undefined, env),
      app.request(`/api/user/byId?id=${userId}`, undefined, env),
      app.request("/api/scrobble/getRecent?username=alex&offset=0", undefined, env),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Profile is private" });
    }
  });

  test("treats an account that has not onboarded as not found", async () => {
    const { env, db } = await seed();

    await db.update(users).set({ onboarded: false }).where(eq(users.id, userId));

    const app = createApp();

    const responses = await Promise.all([
      app.request("/api/user/byUsername?username=alex", undefined, env),
      app.request(`/api/user/byId?id=${userId}`, undefined, env),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "User not found" });
    }
  });
});

describe("authenticated routes", () => {
  test("rejects the session routes without a session", async () => {
    const app = createApp();

    const requests = [
      app.request("/api/user/me", undefined, env),
      app.request("/api/user/onboard", { method: "PUT" }, env),
      app.request("/api/user/settings", { method: "PATCH" }, env),
      app.request("/api/notifications", undefined, env),
      app.request("/api/notifications/any-id/acknowledge", { method: "POST" }, env),
      app.request("/api/import", { method: "POST" }, env),
      app.request("/api/import/latest", undefined, env),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
      // The error handler forwards HTTPException's empty message.
      expect(await response.json()).toEqual({ error: "" });
    }
  });
});

async function signIn(
  env: Cloudflare.Env,
  spotify: { id: string; email: string },
): Promise<{ cookie: string; userId: string }> {
  const app = createApp();

  network.use(
    http.all("https://*.spotify.com/*", async ({ request }) => {
      const url = request.url;

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
    }),
  );

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
}

describe("settings routes", () => {
  test("returns the privacy setting on the current user", async () => {
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
