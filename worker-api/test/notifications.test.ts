import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import z from "zod";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import { notifications } from "../src/db/schema.ts";
import { SPOTIFY_REAUTH_TYPE } from "../src/notifications/spotify-reauth.ts";
import { baseUrl, signIn } from "./session.ts";

const OUTDATED_SCOPE = "user-read-private user-read-email user-read-recently-played";

const listSchema = z.object({
  notifications: z.array(z.object({ id: z.string(), type: z.string() })),
});

async function listNotifications(cookie: string) {
  const response = await createApp().request(
    `${baseUrl}/api/notifications`,
    { headers: { cookie } },
    env,
  );

  expect(response.status).toBe(200);

  return listSchema.parse(await response.json()).notifications;
}

async function findAcknowledgedAt(id: string) {
  const row = await createDatabase(env.DB).query.notifications.findFirst({ where: { id } });

  return row?.acknowledgedAt;
}

describe("notifications", () => {
  test("another user's notification answers 404 and stays unacknowledged", async () => {
    const owner = await signIn({ id: "owner-account", email: "owner@example.com" });
    const other = await signIn({ id: "other-account", email: "other@example.com" });

    const [notification] = await createDatabase(env.DB)
      .insert(notifications)
      .values({ userId: owner.userId, type: "test", title: "Welcome", body: "Welcome body" })
      .returning();

    const response = await createApp().request(
      `${baseUrl}/api/notifications/${notification!.id}/acknowledge`,
      { method: "POST", headers: { cookie: other.cookie } },
      env,
    );

    expect(response.status).toBe(404);
    expect(await findAcknowledgedAt(notification!.id)).toBeNull();
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
