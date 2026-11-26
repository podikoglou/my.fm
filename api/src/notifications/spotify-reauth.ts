import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import type { SqlClient as SqlClientService } from "effect/sql/SqlClient";

import type { DbError } from "../db/errors.ts";
import { asDbError } from "../db/service.ts";
import { acknowledgeNotificationsByType, insertNotification } from "../db/queries/notifications.ts";
import type { User } from "../db/schema.ts";
import type { NotificationSource } from "./service.ts";

export const SPOTIFY_REAUTH_TYPE = "spotify-reauth";

/** The scope that grants from before the app asked for it are missing. */
export const SPOTIFY_REAUTH_SCOPE = "user-read-currently-playing";

const TITLE = "Reconnect Spotify";

const BODY = "Sign in again to let my.fm show what you are playing.";

const hasSpotifyAccountLackingScope = Effect.fn("Notifications.hasSpotifyAccountLackingScope")(
  function* (userId: User["id"]) {
    const sql = yield* SqlClient.SqlClient;

    const find = SqlSchema.findAll({
      Request: Schema.Struct({ userId: Schema.String }),
      Result: Schema.Struct({ id: Schema.String }),
      execute: ({ userId }) => sql`
      SELECT id
      FROM accounts
      WHERE user_id = ${userId}
        AND provider_id = 'spotify'
        AND instr(
          ',' || replace(coalesce(scope, ''), ' ', ',') || ',',
          ${`,${SPOTIFY_REAUTH_SCOPE},`}
        ) = 0
      LIMIT 1
    `,
    });

    return (yield* asDbError(find({ userId }))).length > 0;
  },
);

export const spotifyReauthNotificationSource: NotificationSource = {
  type: SPOTIFY_REAUTH_TYPE,
  sync: Effect.fn("Notifications.syncSpotifyReauth")(function* (
    userId: User["id"],
    nowMs: number,
  ): Effect.fn.Return<void, DbError, SqlClientService> {
    const needsReauth = yield* hasSpotifyAccountLackingScope(userId);

    if (needsReauth) {
      yield* insertNotification(userId, {
        type: SPOTIFY_REAUTH_TYPE,
        title: TITLE,
        body: BODY,
      });

      return;
    }

    yield* acknowledgeNotificationsByType(userId, SPOTIFY_REAUTH_TYPE, nowMs);
  }),
};
