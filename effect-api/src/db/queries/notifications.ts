import { and, desc, eq, isNull, sql } from "drizzle-orm";

import type { DrizzleDatabase } from "../service.ts";
import type { Notification, User } from "../schema.ts";

import { notifications } from "../schema.ts";

export const SPOTIFY_REAUTH_TYPE = "spotify-reauth";

/** The scope that grants from before the app asked for it are missing. */
export const SPOTIFY_REAUTH_SCOPE = "user-read-currently-playing";

const TITLE = "Reconnect Spotify";

const BODY = "Sign in again to let my.fm show what you are playing.";

// Better Auth stores scopes comma-separated; Spotify returns them space-separated.
const lacksScope = sql`instr(',' || replace(coalesce(scope, ''), ' ', ',') || ',', ${`,${SPOTIFY_REAUTH_SCOPE},`}) = 0`;

export type UnacknowledgedNotification = Pick<
  Notification,
  "id" | "type" | "title" | "body" | "createdAt"
>;

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

export async function syncSpotifyReauthNotification(
  db: DrizzleDatabase,
  userId: User["id"],
  nowMs: number,
): Promise<void> {
  await db.run(sql`
    insert into notifications (userId, type, title, body)
    select user_id, ${SPOTIFY_REAUTH_TYPE}, ${TITLE}, ${BODY}
    from accounts
    where user_id = ${userId} and provider_id = 'spotify' and ${lacksScope}
    on conflict do nothing
  `);

  await db.run(sql`
    update notifications
    set acknowledgedAt = ${nowMs}
    where userId = ${userId}
      and type = ${SPOTIFY_REAUTH_TYPE}
      and acknowledgedAt is null
      and not exists (
        select 1 from accounts
        where user_id = ${userId} and provider_id = 'spotify' and ${lacksScope}
      )
  `);
}
