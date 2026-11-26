import { Command, Head, Router, UiSchema } from "@effect/ui";
import { Html, HtmlHead } from "@effect/ui/html";
import { Schema } from "effect";

import { EmptyState } from "./components/EmptyState";
import { FeedPage } from "./features/feed/FeedPage";
import { NotificationList } from "./features/notifications/NotificationList";
import { AppRoute } from "./routes";

export const AppMessage = UiSchema.TaggedEnum({ ChangedRoute: { route: AppRoute } });

export const App = Html.component({
  name: "App",
  props: Schema.Struct({ route: AppRoute }),
  model: Schema.Struct({ route: AppRoute }),
  message: AppMessage,
}).make({
  init: ($) =>
    $.props.route._tag === "Index"
      ? $.set({ route: $.props.route }).run(
          Router.replace(AppRoute, AppRoute.Feed()).pipe(Command.asNoop),
        )
      : { route: $.props.route },
  update: {
    ChangedRoute: ($, { route }) =>
      route._tag === "Index"
        ? $.set({ route }).run(Router.replace(AppRoute, AppRoute.Feed()).pipe(Command.asNoop))
        : { route },
  },
  subscriptions: ({ model }) => [
    Router.subscription(AppRoute, model.route, (route) => AppMessage.ChangedRoute({ route })),
  ],
  head: () => [Head.titleTemplate((title) => `${title} · my.fm`), HtmlHead.lang("en")],
  view: (h, { route }) =>
    h.div
      .class(
        "flex min-h-dvh w-full items-center justify-center sm:container sm:mx-auto sm:min-h-screen sm:max-w-md",
      )
      .children(
        h.main
          .class(
            "flex h-dvh w-full flex-col gap-6 overflow-x-hidden overflow-y-auto border-0 bg-card pt-[max(1.5rem,env(safe-area-inset-top))] pr-[env(safe-area-inset-right)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] text-card-foreground sm:h-168 sm:max-w-lg sm:overflow-hidden sm:rounded-xl sm:border sm:px-0 sm:py-6 sm:shadow-sm",
          )
          .children(
            NotificationList(h, {}),
            AppRoute.match(route, {
              Index: () => h.div.class("hidden"),
              Feed: () => FeedPage(h, {}),
              User: () => EmptyState(h, "Profile", "This page has not been migrated yet."),
              Settings: () => EmptyState(h, "Settings", "This page has not been migrated yet."),
              Onboard: () => EmptyState(h, "Welcome", "This page has not been migrated yet."),
              AuthError: () =>
                EmptyState(h, "Sign-in failed", "This page has not been migrated yet."),
              OAuthAuthorize: () =>
                EmptyState(h, "Authorize app", "This page has not been migrated yet."),
              NotFound: () =>
                EmptyState(h, "Page Not Found", "The page you're looking for doesn't exist."),
            }),
          ),
      ),
});
