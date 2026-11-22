import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { RequireSessionMiddleware } from "./auth.ts";
import { NotificationNotFoundApiError, ServiceUnavailableApiError } from "./errors.ts";

export const NotificationSchema = Schema.Struct({
  id: Schema.String,
  type: Schema.String,
  title: Schema.String,
  body: Schema.String,
  createdAt: Schema.DateFromString,
});

export const ListNotificationsResponse = Schema.Struct({
  notifications: Schema.Array(NotificationSchema),
});

export const AcknowledgeNotificationResponse = Schema.Struct({
  ok: Schema.Literal(true),
});

export class NotificationsGroup extends HttpApiGroup.make("notifications")
  .add(
    HttpApiEndpoint.get("list", "/notifications", {
      success: ListNotificationsResponse,
      error: [ServiceUnavailableApiError],
    }).middleware(RequireSessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("acknowledge", "/notifications/:id/acknowledge", {
      params: { id: Schema.String.check(Schema.isMinLength(1)) },
      success: AcknowledgeNotificationResponse,
      error: [NotificationNotFoundApiError, ServiceUnavailableApiError],
    }).middleware(RequireSessionMiddleware),
  )
  .prefix("/api") {}
