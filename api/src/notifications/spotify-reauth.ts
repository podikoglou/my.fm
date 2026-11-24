import { and, eq, sql } from "drizzle-orm";
import { Effect } from "effect";

import type { DbError } from "../db/errors.ts";
import type { User } from "../db/schema.ts";
import type { Db, DrizzleDatabase } from "../db/service.ts";
import type { NotificationSource } from "./service.ts";

import { acknowledgeNotificationsByType, insertNotification } from "../db/queries/notifications.ts";
import { accounts } from "../db/schema.ts";

export const SPOTIFY_REAUTH_TYPE = "spotify-reauth";

/** The scope that grants from before the app asked for it are missing. */
export const SPOTIFY_REAUTH_SCOPE = "user-read-currently-playing";

const TITLE = "Reconnect Spotify";

const BODY = "Sign in again to let my.fm show what you are playing.";

// Better Auth stores scopes comma-separated; Spotify returns them space-separated.
const lacksScope = sql`instr(',' || replace(coalesce(${accounts.scope}, ''), ' ', ',') || ',', ${`,${SPOTIFY_REAUTH_SCOPE},`}) = 0`;

async function hasSpotifyAccountLackingScope(
  db: DrizzleDatabase,
  userId: User["id"],
): Promise<boolean> {
  const rows = await db
    .select({ id: accounts.id })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), eq(accounts.providerId, "spotify"), lacksScope))
    .limit(1);

  return rows.length > 0;
}

export const spotifyReauthNotificationSource: NotificationSource = {
  type: SPOTIFY_REAUTH_TYPE,
  sync: Effect.fn("Notifications.syncSpotifyReauth")(function* (
    db: Db["Service"],
    userId: User["id"],
    nowMs: number,
  ): Effect.fn.Return<void, DbError> {
    const needsReauth = yield* db.query((client) => hasSpotifyAccountLackingScope(client, userId));

    if (needsReauth) {
      yield* db.query((client) =>
        insertNotification(client, userId, {
          type: SPOTIFY_REAUTH_TYPE,
          title: TITLE,
          body: BODY,
        }),
      );

      return;
    }

    yield* db.query((client) =>
      acknowledgeNotificationsByType(client, userId, SPOTIFY_REAUTH_TYPE, nowMs),
    );
  }),
};
