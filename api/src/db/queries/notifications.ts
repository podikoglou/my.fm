import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { DateFromEpochSeconds } from "../columns.ts";
import { asDbError } from "../service.ts";
import type { Notification, User } from "../schema.ts";

export type NotificationDraft = Pick<Notification, "type" | "title" | "body">;

export type UnacknowledgedNotification = Pick<
  Notification,
  "id" | "type" | "title" | "body" | "createdAt"
>;

const UnacknowledgedNotificationRow = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: Schema.String,
  body: Schema.String,
  createdAt: DateFromEpochSeconds,
});

export const findUnacknowledgedNotifications = Effect.fn("notifications.findUnacknowledged")(
  function* (userId: User["id"]) {
    const sql = yield* SqlClient.SqlClient;

    const find = SqlSchema.findAll({
      Request: Schema.Struct({ userId: Schema.String }),
      Result: UnacknowledgedNotificationRow,
      execute: ({ userId }) =>
        sql`SELECT id, type, title, body, createdAt FROM notifications WHERE userId = ${userId} AND acknowledgedAt IS NULL ORDER BY createdAt DESC, id DESC`,
    });

    return yield* asDbError(find({ userId }));
  },
);

export const insertNotification = Effect.fn("notifications.insert")(function* (
  userId: User["id"],
  draft: NotificationDraft,
) {
  const sql = yield* SqlClient.SqlClient;

  yield* asDbError(sql`
    INSERT INTO notifications (userId, type, title, body)
    VALUES (${userId}, ${draft.type}, ${draft.title}, ${draft.body})
    ON CONFLICT DO NOTHING
  `);
});

export const acknowledgeNotification = Effect.fn("notifications.acknowledge")(function* (
  userId: User["id"],
  id: Notification["id"],
  nowMs: number,
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findAll({
    Request: Schema.Struct({
      userId: Schema.String,
      id: Schema.String,
      nowMs: Schema.Number,
    }),
    Result: Schema.Struct({ id: Schema.String }),
    execute: ({ userId, id, nowMs }) =>
      sql`UPDATE notifications SET acknowledgedAt = COALESCE(acknowledgedAt, ${nowMs}) WHERE id = ${id} AND userId = ${userId} RETURNING id`,
  });

  const rows = yield* asDbError(find({ userId, id, nowMs }));

  return rows.length > 0;
});

export const acknowledgeNotificationsByType = Effect.fn("notifications.acknowledgeByType")(
  function* (userId: User["id"], type: Notification["type"], nowMs: number) {
    const sql = yield* SqlClient.SqlClient;

    yield* asDbError(sql`
    UPDATE notifications
    SET acknowledgedAt = ${nowMs}
    WHERE userId = ${userId}
      AND type = ${type}
      AND acknowledgedAt IS NULL
  `);
  },
);
