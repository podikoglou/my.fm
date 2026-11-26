import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { describe, expect, test } from "vitest";

import { SPOTIFY_REAUTH_TYPE } from "../src/notifications/spotify-reauth.ts";
import worker from "../src/worker.ts";
import { baseUrl, signIn } from "./session.ts";
import { insertRows, queryRows } from "./d1.ts";

const OUTDATED_SCOPE = "user-read-private user-read-email user-read-recently-played";

const ListNotificationsSchema = Schema.Struct({
  notifications: Schema.Array(Schema.Struct({ id: Schema.String, type: Schema.String })),
});

const decodeList = Schema.decodeUnknownSync(ListNotificationsSchema);

async function listNotifications(cookie: string) {
  const response = await worker.fetch(
    new Request(`${baseUrl}/api/notifications`, { headers: { cookie } }),
    env,
  );

  expect(response.status).toBe(200);

  return decodeList(await response.json()).notifications;
}

async function findAcknowledgedAt(id: string) {
  const [row] = await queryRows<{ acknowledgedAt: number | null }>(
    env.DB,
    "SELECT acknowledgedAt FROM notifications WHERE id = ?",
    [id],
  );

  return row?.acknowledgedAt === null || row?.acknowledgedAt === undefined
    ? null
    : new Date(row.acknowledgedAt);
}

describe("notifications", () => {
  test("rejects unauthenticated notification requests", async () => {
    const responses = await Promise.all([
      worker.fetch(new Request(`${baseUrl}/api/notifications`), env),
      worker.fetch(
        new Request(`${baseUrl}/api/notifications/any-id/acknowledge`, { method: "POST" }),
        env,
      ),
    ]);

    for (const response of responses) {
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "" });
    }
  });

  test("another user's notification answers 404 and stays unacknowledged", async () => {
    const owner = await signIn({ id: "owner-account", email: "owner@example.com" });
    const other = await signIn({ id: "other-account", email: "other@example.com" });

    const notification = {
      id: crypto.randomUUID(),
      userId: owner.userId,
      type: "test",
      title: "Welcome",
      body: "Welcome body",
      createdAt: new Date(),
    };

    await insertRows(env.DB, "notifications", [notification]);

    const response = await worker.fetch(
      new Request(`${baseUrl}/api/notifications/${notification.id}/acknowledge`, {
        method: "POST",
        headers: { cookie: other.cookie },
      }),
      env,
    );

    expect(response.status).toBe(404);
    expect(await findAcknowledgedAt(notification.id)).toBeNull();
  });

  test("asks an outdated Spotify grant to sign in again until it has the scope", async () => {
    const spotify = { id: "spotify-reauth", email: "reauth@example.com" };
    const outdated = await signIn({ ...spotify, scope: OUTDATED_SCOPE });

    const first = await listNotifications(outdated.cookie);

    expect(first.map(({ type }) => type)).toEqual([SPOTIFY_REAUTH_TYPE]);
    expect(await listNotifications(outdated.cookie)).toEqual(first);

    const renewed = await signIn(spotify);

    expect(await listNotifications(renewed.cookie)).toEqual([]);
    expect(await findAcknowledgedAt(first[0]!.id)).toBeInstanceOf(Date);
  });
});
