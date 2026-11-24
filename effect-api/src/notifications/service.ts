import { Clock, Context, Effect, Layer } from "effect";

import type { DbError } from "../db/errors.ts";
import type { Notification, User } from "../db/schema.ts";

import {
  acknowledgeNotification,
  acknowledgeNotificationsByType,
  findUnacknowledgedNotifications,
  insertNotification,
  type NotificationDraft,
  type UnacknowledgedNotification,
} from "../db/queries/notifications.ts";
import { Db } from "../db/service.ts";
import { NotificationNotFoundError } from "./errors.ts";
import { spotifyReauthNotificationSource } from "./spotify-reauth.ts";

export interface NotificationSource {
  readonly type: Notification["type"];
  readonly sync: (
    db: Db["Service"],
    userId: User["id"],
    nowMs: number,
  ) => Effect.Effect<void, DbError>;
}

export interface NotificationsApi {
  readonly create: (userId: User["id"], draft: NotificationDraft) => Effect.Effect<void, DbError>;
  readonly listUnacknowledged: (
    userId: User["id"],
  ) => Effect.Effect<UnacknowledgedNotification[], DbError>;
  readonly acknowledge: (
    userId: User["id"],
    id: Notification["id"],
  ) => Effect.Effect<void, NotificationNotFoundError | DbError>;
  readonly acknowledgeByType: (
    userId: User["id"],
    type: Notification["type"],
  ) => Effect.Effect<void, DbError>;
}

export class Notifications extends Context.Service<Notifications, NotificationsApi>()(
  "@my.fm/effect-api/notifications/Notifications",
) {
  static makeLayer(
    sources: ReadonlyArray<NotificationSource>,
  ): Layer.Layer<Notifications, never, Db> {
    return Layer.effect(
      Notifications,
      Effect.gen(function* () {
        const db = yield* Db;

        const create = Effect.fn("Notifications.create")(function* (
          userId: User["id"],
          draft: NotificationDraft,
        ) {
          return yield* db.query((client) => insertNotification(client, userId, draft));
        });

        const listUnacknowledged = Effect.fn("Notifications.listUnacknowledged")(function* (
          userId: User["id"],
        ) {
          const nowMs = yield* Clock.currentTimeMillis;

          for (const source of sources) {
            yield* source.sync(db, userId, nowMs);
          }

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

        const acknowledgeByType = Effect.fn("Notifications.acknowledgeByType")(function* (
          userId: User["id"],
          type: Notification["type"],
        ) {
          const nowMs = yield* Clock.currentTimeMillis;

          return yield* db.query((client) =>
            acknowledgeNotificationsByType(client, userId, type, nowMs),
          );
        });

        return Notifications.of({
          create,
          listUnacknowledged,
          acknowledge,
          acknowledgeByType,
        });
      }),
    );
  }

  static readonly layer: Layer.Layer<Notifications, never, Db> = Notifications.makeLayer([
    spotifyReauthNotificationSource,
  ]);
}
