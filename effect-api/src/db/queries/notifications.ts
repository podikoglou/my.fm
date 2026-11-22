import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { DrizzleDatabase } from "../service.ts";
import type { Notification, User } from "../schema.ts";

import { notifications } from "../schema.ts";

export type UnacknowledgedNotification = Pick<
  Notification,
  "id" | "type" | "title" | "body" | "createdAt"
>;

export type NotificationDraft = Pick<Notification, "type" | "title" | "body">;

export async function findUnacknowledgedNotifications(
  db: DrizzleDatabase,
  userId: User["id"],
): Promise<UnacknowledgedNotification[]> {
  return await db
    .select({
      id: notifications.id,
      type: notifications.type,
      title: notifications.title,
      body: notifications.body,
      createdAt: notifications.createdAt,
    })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.acknowledgedAt)))
    .orderBy(desc(notifications.createdAt), desc(notifications.id));
}

export async function insertNotification(
  db: DrizzleDatabase,
  userId: User["id"],
  draft: NotificationDraft,
): Promise<void> {
  await db
    .insert(notifications)
    .values({
      userId,
      type: draft.type,
      title: draft.title,
      body: draft.body,
    })
    .onConflictDoNothing();
}

export async function acknowledgeNotification(
  db: DrizzleDatabase,
  userId: User["id"],
  id: Notification["id"],
  nowMs: number,
): Promise<boolean> {
  const acknowledged = await db
    .update(notifications)
    .set({ acknowledgedAt: sql`coalesce(${notifications.acknowledgedAt}, ${nowMs})` })
    .where(and(eq(notifications.id, id), eq(notifications.userId, userId)))
    .returning({ id: notifications.id });

  return acknowledged.length > 0;
}

export async function acknowledgeNotificationsByType(
  db: DrizzleDatabase,
  userId: User["id"],
  type: Notification["type"],
  nowMs: number,
): Promise<void> {
  await db
    .update(notifications)
    .set({ acknowledgedAt: new Date(nowMs) })
    .where(
      and(
        eq(notifications.userId, userId),
        eq(notifications.type, type),
        isNull(notifications.acknowledgedAt),
      ),
    );
}
