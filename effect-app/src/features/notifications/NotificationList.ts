import { NotificationSchema } from "@my.fm/api";
import { Command, Component, Query, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { icon } from "../../components/icon";
import { apiClient } from "../../lib/api";
import { authClient, signInWithSpotify } from "../../lib/auth";

export class ListNotifications extends Query.Service<ListNotifications>()(
  "notifications/ListNotifications",
  {
    args: {},
    success: Schema.Array(NotificationSchema),
    error: Schema.String,
    staleTime: "0 seconds",
  },
) {
  static readonly layer = this.toLayer(() =>
    Effect.gen(function* () {
      const session = yield* Effect.tryPromise({
        try: () => authClient.getSession(),
        catch: () => "Session unavailable",
      });

      if (!session.data) return [];

      const result = yield* apiClient.notifications
        .list()
        .pipe(Effect.mapError(() => "Notifications unavailable"));

      return result.notifications;
    }),
  );
}

export const NotificationListMessage = UiSchema.TaggedEnum({
  ClickedNotification: { notification: NotificationSchema },
  SucceededAcknowledge: { id: Schema.String },
  FailedAcknowledge: {},
});

export const AcknowledgeNotification = Command.make(
  "AcknowledgeNotification",
  {
    args: { notification: NotificationSchema },
    mode: "switch",
  },
  ({ notification }) =>
    Effect.gen(function* () {
      yield* apiClient.notifications.acknowledge({ params: { id: notification.id } });

      if (notification.type === "spotify-reauth") {
        yield* Effect.tryPromise(async () => {
          const result = await authClient.signOut();

          if (result.error) throw new Error(result.error.message ?? "Sign out failed");
          await signInWithSpotify(window.location.pathname);
        });
      }

      return notification.id;
    }).pipe(
      Effect.match({
        onSuccess: (id) => NotificationListMessage.SucceededAcknowledge({ id }),
        onFailure: () => NotificationListMessage.FailedAcknowledge(),
      }),
    ),
);

export const NotificationListNoDeps = Html.component({
  name: "NotificationList",
  model: Schema.Struct({
    pending: Schema.Boolean,
    failed: Schema.Boolean,
    acknowledged: Schema.Array(Schema.String),
  }),
  message: NotificationListMessage,
  queries: { notifications: { query: ListNotifications, args: () => ({}) } },
}).make({
  init: () => ({ pending: false, failed: false, acknowledged: [] }),
  update: {
    ClickedNotification: ($, { notification }) =>
      $.model.pending
        ? $.model
        : $.evolve({ pending: true, failed: false }).run(
            AcknowledgeNotification.make({ notification }),
          ),
    SucceededAcknowledge: ($, { id }) =>
      $.evolve({ pending: false, acknowledged: (ids) => [...ids, id] }),
    FailedAcknowledge: ($) => $.evolve({ pending: false, failed: true }),
  },
  view: (h, model) =>
    AsyncResult.match(h.queries.notifications, {
      onInitial: () => h.div.class("hidden"),
      onFailure: () => h.div.class("hidden"),
      onSuccess: ({ value }) => {
        const notifications = value.filter(({ id }) => !model.acknowledged.includes(id));

        if (notifications.length === 0) return h.div.class("hidden");

        return h.div.class("flex max-h-48 shrink-0 flex-col gap-2 overflow-y-auto px-6").children(
          h.ul
            .attr("aria-label", "Notifications")
            .class("flex flex-col gap-2")
            .children(
              notifications.map((notification) =>
                h.li.key(notification.id).children(
                  h.button
                    .attr("type", "button")
                    .disabled(model.pending)
                    .class(
                      "block w-full cursor-pointer rounded-lg text-left focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:outline-none disabled:cursor-default disabled:opacity-50",
                    )
                    .on("click", NotificationListMessage.ClickedNotification({ notification }))
                    .children(
                      h.div
                        .class(
                          "relative grid w-full grid-cols-[1rem_1fr] items-start gap-x-3 gap-y-0.5 rounded-lg border bg-card px-4 py-3 text-sm",
                        )
                        .children(
                          icon(
                            h,
                            notification.type === "spotify-reauth" ? "key" : "bell",
                            "size-4 translate-y-0.5",
                          ),
                          h.h4
                            .class("col-start-2 min-h-4 font-medium tracking-tight")
                            .children(notification.title),
                          h.div
                            .class("col-start-2 text-sm text-muted-foreground")
                            .children(notification.body),
                        ),
                    ),
                ),
              ),
            ),
          model.failed &&
            h.p
              .class("text-sm text-destructive")
              .children("Something went wrong. Please try again."),
        );
      },
    }),
});

export const NotificationList = NotificationListNoDeps.pipe(
  Component.provide(ListNotifications.layer),
);
