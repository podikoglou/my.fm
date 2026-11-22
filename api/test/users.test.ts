import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { Effect, Layer } from "effect";
import { describe, expect, test } from "vitest";

import { findUserByIdPublic, findUserByUsernamePublic } from "../src/db/queries/users.ts";
import { users } from "../src/db/schema.ts";
import { createDatabase, Db } from "../src/db/service.ts";
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

  return { db };
}

function runUsers<A, E>(effect: Effect.Effect<A, E, Users>) {
  const layer = Users.layer.pipe(Layer.provide(Db.layerFromBinding(env.DB)));

  return Effect.runPromise(effect.pipe(Effect.provide(layer)));
}

describe("user service and queries", () => {
  test("resolves a private profile for its owner and hides it from others", async () => {
    const { db } = await seed();

    await db.update(users).set({ isPrivate: true }).where(eq(users.id, userId));

    const mcpMe = await runUsers(
      Effect.gen(function* () {
        const service = yield* Users;

        return yield* service.getMeForMcp(userId);
      }),
    );

    expect(mcpMe).toEqual({
      id: userId,
      username: "alex",
      name: "Alex",
      onboarded: true,
      isPrivate: true,
    });

    const ownerView = await runUsers(
      Effect.gen(function* () {
        const service = yield* Users;

        return yield* service.viewProfileByUsername("alex", userId);
      }),
    );

    expect(ownerView).toEqual({
      id: userId,
      username: "alex",
      name: "Alex",
      avatarUrl: "https://example.com/alex.jpg",
    });

    const otherView = await runUsers(
      Effect.gen(function* () {
        const service = yield* Users;

        return yield* service.viewProfileByUsername("alex", "other").pipe(Effect.flip);
      }),
    );

    expect(otherView._tag).toBe("ProfilePrivateError");
  });

  test("reports missing users", async () => {
    const missingMe = await runUsers(
      Effect.gen(function* () {
        const service = yield* Users;

        return yield* service.getMeForMcp(userId).pipe(Effect.flip);
      }),
    );

    expect(missingMe._tag).toBe("UserNotFoundError");

    const missingProfile = await runUsers(
      Effect.gen(function* () {
        const service = yield* Users;

        return yield* service.viewProfileByUsername("missing").pipe(Effect.flip);
      }),
    );

    expect(missingProfile._tag).toBe("UserNotFoundError");
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

describe("anonymous user reads", () => {
  test("serves a public profile without a session", async () => {
    await seed();

    const byUsername = await worker.fetch(
      new Request(`${baseUrl}/api/user/byUsername?username=alex`),
      env,
    );

    const byId = await worker.fetch(new Request(`${baseUrl}/api/user/byId?id=${userId}`), env);

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

  test("hides a private profile from an anonymous visitor", async () => {
    const { db } = await seed();

    await db.update(users).set({ isPrivate: true }).where(eq(users.id, userId));

    const responses = await Promise.all([
      worker.fetch(new Request(`${baseUrl}/api/user/byUsername?username=alex`), env),
      worker.fetch(new Request(`${baseUrl}/api/user/byId?id=${userId}`), env),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Profile is private" });
    }
  });

  test("treats an account that has not onboarded as not found", async () => {
    const { db } = await seed();

    await db.update(users).set({ onboarded: false }).where(eq(users.id, userId));

    const responses = await Promise.all([
      worker.fetch(new Request(`${baseUrl}/api/user/byUsername?username=alex`), env),
      worker.fetch(new Request(`${baseUrl}/api/user/byId?id=${userId}`), env),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(404);
      expect(await response.json()).toEqual({ error: "User not found" });
    }
  });
});

describe("authenticated user routes", () => {
  test("rejects the session routes without a session", async () => {
    const requests = [
      worker.fetch(new Request(`${baseUrl}/api/user/me`), env),
      worker.fetch(new Request(`${baseUrl}/api/user/onboard`, { method: "PUT" }), env),
      worker.fetch(new Request(`${baseUrl}/api/user/settings`, { method: "PATCH" }), env),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "" });
    }
  });
});

describe("settings routes", () => {
  test("returns the privacy setting on the current user", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/user/me`, { headers: { cookie: owner.cookie } }),
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
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/user/settings`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ isPrivate: true }),
      }),
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
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/user/settings`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ isPrivate: "yes" }),
      }),
      env,
    );

    expect(response.status).toBe(400);
  });

  test("hides the profile from other users after the owner makes it private", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn({ id: "spotify-other", email: "other@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true })
      .where(eq(users.id, owner.userId));

    const settings = await worker.fetch(
      new Request(`${baseUrl}/api/user/settings`, {
        method: "PATCH",
        headers: { cookie: owner.cookie, "content-type": "application/json" },
        body: JSON.stringify({ isPrivate: true }),
      }),
      env,
    );

    expect(settings.status).toBe(200);

    const profile = await worker.fetch(
      new Request(`${baseUrl}/api/user/byUsername?username=alex`, {
        headers: { cookie: other.cookie },
      }),
      env,
    );

    expect(profile.status).toBe(403);
    expect(await profile.json()).toEqual({ error: "Profile is private" });
  });
});

describe("onboarding route", () => {
  test("onboards an authenticated user and rejects repeat onboarding", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });

    const form = new URLSearchParams({ username: "alex_fm", name: "Alex P." });

    const first = await worker.fetch(
      new Request(`${baseUrl}/api/user/onboard`, {
        method: "PUT",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }),
      env,
    );

    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });

    const updated = await createDatabase(env.DB).query.users.findFirst({
      where: { id: owner.userId },
    });

    expect(updated?.username).toBe("alex_fm");
    expect(updated?.name).toBe("Alex P.");
    expect(updated?.onboarded).toBe(true);

    const repeat = await worker.fetch(
      new Request(`${baseUrl}/api/user/onboard`, {
        method: "PUT",
        headers: {
          cookie: owner.cookie,
          "content-type": "application/x-www-form-urlencoded",
        },
        body: form.toString(),
      }),
      env,
    );

    expect(repeat.status).toBe(400);
    expect(await repeat.json()).toEqual({ error: "Already onboarded" });
  });
});

describe("profile visibility", () => {
  test("hides a private profile from other users", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn({ id: "spotify-other", email: "other@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true, isPrivate: true })
      .where(eq(users.id, owner.userId));

    const headers = { cookie: other.cookie };

    const requests = [
      worker.fetch(new Request(`${baseUrl}/api/user/byUsername?username=alex`, { headers }), env),
      worker.fetch(new Request(`${baseUrl}/api/user/byId?id=${owner.userId}`, { headers }), env),
    ];

    for (const response of await Promise.all(requests)) {
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ error: "Profile is private" });
    }
  });

  test("shows a private profile to its owner", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true, isPrivate: true })
      .where(eq(users.id, owner.userId));

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/user/byUsername?username=alex`, {
        headers: { cookie: owner.cookie },
      }),
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
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn({ id: "spotify-other", email: "other@example.com" });

    await createDatabase(env.DB)
      .update(users)
      .set({ username: "alex", name: "Alex", onboarded: true })
      .where(eq(users.id, owner.userId));

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/user/byUsername?username=alex`, {
        headers: { cookie: other.cookie },
      }),
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
