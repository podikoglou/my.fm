import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { Database } from "../index.ts";
import type { Notification, User } from "../schema.ts";

import { notifications } from "../schema.ts";

export type UnacknowledgedNotification = Pick<Notification, "id" | "title" | "body" | "createdAt">;

export async function findUnacknowledgedNotifications(
  db: Database,
  userId: User["id"],
): Promise<UnacknowledgedNotification[]> {
  return await db
    .select({
      id: notifications.id,
      title: notifications.title,
      body: notifications.body,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.acknowledgedAt)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

/**
 * Acknowledge one of the user's notifications. Returns whether the user owns
 * it, so another user's notification reads the same as one that does not
 * exist. A second acknowledgement keeps the first time.
 */
export async function acknowledgeNotification(
  db: Database,
  userId: User["id"],
  id: Notification["id"],
  now = new Date(),
): Promise<boolean> {
  const acknowledged = await db
    .update(notifications)
    .set({ acknowledgedAt: sql`coalesce(${notifications.acknowledgedAt}, ${now.getTime()})` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });

  return acknowledged.length > 0;
}
