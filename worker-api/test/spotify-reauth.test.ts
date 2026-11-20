import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import z from "zod";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import { SPOTIFY_REAUTH_TYPE } from "../src/notifications/spotify-reauth.ts";
import { baseUrl, signIn } from "./session.ts";

const OUTDATED_SCOPE = "user-read-private user-read-email user-read-recently-played";

const spotify = { id: "spotify-reauth", email: "reauth@example.com" };

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

async function findStoredNotifications(userId: string) {
  return createDatabase(env.DB).query.notifications.findMany({ where: { userId } });
}

describe("Spotify reauthorization notification", () => {
  test("is created once for a grant without the scope", async () => {
    const { cookie, userId } = await signIn({ ...spotify, scope: OUTDATED_SCOPE });

    const first = await listNotifications(cookie);
    const second = await listNotifications(cookie);

    expect(first.map(({ type }) => type)).toEqual([SPOTIFY_REAUTH_TYPE]);
    expect(second).toEqual(first);
    expect(await findStoredNotifications(userId)).toHaveLength(1);
  });

  test("is not created for a grant with the scope", async () => {
    const { cookie, userId } = await signIn(spotify);

    expect(await listNotifications(cookie)).toEqual([]);
    expect(await findStoredNotifications(userId)).toHaveLength(0);
  });

  test("is not created again once the user signs in with the new scope", async () => {
    const outdated = await signIn({ ...spotify, scope: OUTDATED_SCOPE });
    const [notification] = await listNotifications(outdated.cookie);

    const acknowledged = await createApp().request(
      `${baseUrl}/api/notifications/${notification!.id}/acknowledge`,
      { method: "POST", headers: { cookie: outdated.cookie } },
      env,
    );

    expect(acknowledged.status).toBe(200);

    const renewed = await signIn(spotify);

    const account = await createDatabase(env.DB).query.accounts.findFirst({
      where: { userId: renewed.userId },
    });

    expect(account?.scope?.split(",")).toContain("user-read-currently-playing");
    expect(await listNotifications(renewed.cookie)).toEqual([]);
    expect(await findStoredNotifications(renewed.userId)).toHaveLength(1);
  });
});
