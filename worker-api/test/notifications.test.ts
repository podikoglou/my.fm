import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { describe, expect, test } from "vitest";
import z from "zod";

import { createApp } from "../src/app.ts";
import { createDatabase } from "../src/db/index.ts";
import { notifications, users } from "../src/db/schema.ts";
import { baseUrl, signIn } from "./session.ts";

const listSchema = z.object({
  notifications: z.array(
    z.object({
      id: z.string(),
      type: z.string(),
      title: z.string(),
      body: z.string(),
      createdAt: z.string(),
    }),
  ),
});

async function seedNotification(userId: string, title: string, createdAt: Date) {
  const [row] = await createDatabase(env.DB)
    .insert(notifications)
    .values({ userId, type: "test", title, body: `${title} body`, createdAt })
    .returning();

  return row!;
}

async function listNotifications(cookie: string) {
  const response = await createApp().request(
    `${baseUrl}/api/notifications`,
    { headers: { cookie } },
    env,
  );

  expect(response.status).toBe(200);

  return listSchema.parse(await response.json()).notifications;
}

async function acknowledge(id: string, cookie?: string) {
  return createApp().request(
    `${baseUrl}/api/notifications/${id}/acknowledge`,
    { method: "POST", headers: cookie ? { cookie } : {} },
    env,
  );
}

async function findAcknowledgedAt(id: string) {
  const row = await createDatabase(env.DB).query.notifications.findFirst({ where: { id } });

  return row?.acknowledgedAt;
}

describe("notification routes", () => {
  test("require a session", async () => {
    const list = await createApp().request(`${baseUrl}/api/notifications`, {}, env);

    expect(list.status).toBe(401);
    expect((await acknowledge("any-id")).status).toBe(401);
  });

  test("list the user's unacknowledged notifications, newest first", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn({ id: "spotify-other", email: "other@example.com" });

    const older = await seedNotification(owner.userId, "Older", new Date("2026-11-01T00:00:00Z"));
    const newer = await seedNotification(owner.userId, "Newer", new Date("2026-11-02T00:00:00Z"));
    const acknowledged = await seedNotification(owner.userId, "Done", new Date());

    await seedNotification(other.userId, "Not yours", new Date());

    await createDatabase(env.DB)
      .update(notifications)
      .set({ acknowledgedAt: new Date() })
      .where(eq(notifications.id, acknowledged.id));

    const listed = await listNotifications(owner.cookie);

    expect(listed.map(({ id }) => id)).toEqual([newer.id, older.id]);
    expect(listed[0]).toEqual({
      id: newer.id,
      type: "test",
      title: "Newer",
      body: "Newer body",
      createdAt: "2026-11-02T00:00:00.000Z",
    });
  });

  test("acknowledging removes the notification from the list", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const notification = await seedNotification(owner.userId, "Reauthorize", new Date());

    const response = await acknowledge(notification.id, owner.cookie);

    expect(response.status).toBe(200);
    expect(await findAcknowledgedAt(notification.id)).toBeInstanceOf(Date);
    expect(await listNotifications(owner.cookie)).toEqual([]);
  });

  test("acknowledging again keeps the first acknowledgement", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const notification = await seedNotification(owner.userId, "Reauthorize", new Date());

    await acknowledge(notification.id, owner.cookie);
    const first = await findAcknowledgedAt(notification.id);

    expect((await acknowledge(notification.id, owner.cookie)).status).toBe(200);
    expect(await findAcknowledgedAt(notification.id)).toEqual(first);
  });

  test("another user's notification answers 404 and stays unacknowledged", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const other = await signIn({ id: "spotify-other", email: "other@example.com" });
    const notification = await seedNotification(owner.userId, "Reauthorize", new Date());

    const response = await acknowledge(notification.id, other.cookie);

    expect(response.status).toBe(404);
    expect(await findAcknowledgedAt(notification.id)).toBeNull();
  });

  test("an unknown notification answers 404", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });

    expect((await acknowledge("missing", owner.cookie)).status).toBe(404);
  });

  test("deleting a user deletes their notifications", async () => {
    const owner = await signIn({ id: "spotify-owner", email: "owner@example.com" });
    const notification = await seedNotification(owner.userId, "Reauthorize", new Date());
    const db = createDatabase(env.DB);

    await db.delete(users).where(eq(users.id, owner.userId));

    expect(
      await db.query.notifications.findFirst({ where: { id: notification.id } }),
    ).toBeUndefined();
  });
});
