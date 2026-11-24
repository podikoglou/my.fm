import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { CurrentUser, MyFmApi, ServiceUnavailableError } from "../api/index.ts";
import { Notifications } from "../notifications/service.ts";

export const NotificationsHandlers = HttpApiBuilder.group(
  MyFmApi,
  "notifications",
  Effect.fn(function* (handlers) {
    const notifications = yield* Notifications;

    return handlers
      .handle("list", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const items = yield* notifications.listUnacknowledged(user.id).pipe(
            Effect.catchTags({
              D1QuotaExceededError: (error) =>
                Effect.fail(new ServiceUnavailableError({ error: error.message })),
              D1QueryError: (error) => Effect.die(error),
            }),
          );

          return { notifications: items };
        }),
      )
      .handle("acknowledge", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          yield* notifications.acknowledge(user.id, params.id).pipe(
            Effect.catchTags({
              NotificationNotFoundError: () =>
                Effect.fail({ error: "Notification not found" as const }),
              D1QuotaExceededError: (error) =>
                Effect.fail(new ServiceUnavailableError({ error: error.message })),
              D1QueryError: (error) => Effect.die(error),
            }),
          );

          return { ok: true as const };
        }),
      );
  }),
);
