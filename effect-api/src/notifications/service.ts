import { Clock, Context, Effect, Layer } from "effect";

import type { DbError } from "../db/errors.ts";
import type { Notification, User } from "../db/schema.ts";

import {
  acknowledgeNotification,
  findUnacknowledgedNotifications,
  syncSpotifyReauthNotification,
  type UnacknowledgedNotification,
} from "../db/queries/notifications.ts";
import { Db } from "../db/service.ts";
import { NotificationNotFoundError } from "./errors.ts";

export interface NotificationsApi {
  readonly syncSpotifyReauth: (userId: User["id"]) => Effect.Effect<void, DbError>;
  readonly listUnacknowledged: (
    userId: User["id"],
  ) => Effect.Effect<UnacknowledgedNotification[], DbError>;
  readonly acknowledge: (
    userId: User["id"],
    id: Notification["id"],
  ) => Effect.Effect<void, NotificationNotFoundError | DbError>;
}

export class Notifications extends Context.Service<Notifications, NotificationsApi>()(
  "@my.fm/effect-api/notifications/Notifications",
) {
  static readonly layer: Layer.Layer<Notifications, never, Db> = Layer.effect(
    Notifications,
    Effect.gen(function* () {
      const db = yield* Db;

      const syncSpotifyReauth = Effect.fn("Notifications.syncSpotifyReauth")(function* (
        userId: User["id"],
      ) {
        const nowMs = yield* Clock.currentTimeMillis;

        return yield* db.query((client) => syncSpotifyReauthNotification(client, userId, nowMs));
      });

      const listUnacknowledged = Effect.fn("Notifications.listUnacknowledged")(function* (
        userId: User["id"],
      ) {
        yield* syncSpotifyReauth(userId);

        return yield* db.query((client) => findUnacknowledgedNotifications(client, userId));
      });

      const acknowledge = Effect.fn("Notifications.acknowledge")(function* (
        userId: User["id"],
        id: Notification["id"],
      ) {
        const nowMs = yield* Clock.currentTimeMillis;

        const found = yield* db.query((client) =>
          acknowledgeNotification(client, userId, id, nowMs),
        );

        if (!found) {
          return yield* new NotificationNotFoundError({ message: "Notification not found" });
        }
      });

      return Notifications.of({
        syncSpotifyReauth,
        listUnacknowledged,
        acknowledge,
      });
    }),
  );
}
