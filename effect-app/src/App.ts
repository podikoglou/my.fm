import { Command, Component, Head, Query, Router, UiSchema } from "@effect/ui";
import { Html, HtmlHead } from "@effect/ui/html";
import { Effect, Option, Schema } from "effect";

import { icon } from "./components/icon";
import { AuthErrorPage, makeAuthFlowLayer } from "./features/auth/AuthErrorPage";
import { FeedPage } from "./features/feed/FeedPage";
import { NotificationList } from "./features/notifications/NotificationList";
import { OAuthConsentPage } from "./features/oauth-consent/OAuthConsentPage";
import { OnboardPage } from "./features/onboarding/OnboardPage";
import { ProfilePage } from "./features/profile/ProfilePage";
import { GetViewer } from "./features/profile/queries";
import { SettingsPage } from "./features/settings/SettingsPage";
import { AppRoute } from "./routes";

const AppLocation = Schema.Struct({ route: AppRoute, search: Schema.String });

export const AppMessage = UiSchema.TaggedEnum({ ChangedRoute: { location: AppLocation } });

export function readLocation(route: typeof AppRoute.Type): typeof AppLocation.Type {
  return { route, search: window.location.search };
}

const invalidateCurrentUser = Effect.serviceOption(Query.Cache).pipe(
  Effect.flatMap(
    Option.match({
      onNone: () => Effect.void,
      onSome: (cache) => GetViewer.invalidate({}).pipe(Effect.provideService(Query.Cache, cache)),
    }),
  ),
);

function ShellPage(
  h: Html.H<typeof AppMessage.Type>,
  route: Exclude<typeof AppRoute.Type, { _tag: "OAuthAuthorize" }>,
) {
  switch (route._tag) {
    case "Index":
      return h.div.class("hidden");
    case "Feed":
      return FeedPage(h, {});
    case "User":
      return ProfilePage(h, { key: route.params.username, props: route.params });
    case "Settings":
      return SettingsPage(h, {});
    case "Onboard":
      return OnboardPage(h, { key: route.search.returnTo, props: route.search });
    case "AuthError":
      return AuthErrorPage(h, { props: route.search });
    case "NotFound":
      return h.div
        .class("flex flex-1 flex-col items-center justify-center gap-4 px-6 text-center")
        .children(
          icon(h, "frown", "size-16 text-muted-foreground opacity-50"),
          h.div.children(
            h.h1.class("text-3xl leading-none font-bold").children("Page Not Found"),
            h.p
              .class("mt-2 text-sm text-muted-foreground")
              .children("The page you're looking for doesn't exist."),
          ),
        );
  }
}

export const App = Html.component({
  name: "App",
  props: AppLocation,
  model: AppLocation,
  message: AppMessage,
})
  .make({
    init: ($) =>
      $.props.route._tag === "Index"
        ? $.set($.props).run(Router.replace(AppRoute, AppRoute.Feed()).pipe(Command.asNoop))
        : $.props,
    update: {
      ChangedRoute: ($, { location }) =>
        location.route._tag === "Index"
          ? $.set(location).run(Router.replace(AppRoute, AppRoute.Feed()).pipe(Command.asNoop))
          : location,
    },
    subscriptions: ({ model }) => [
      Router.subscription(AppRoute, model.route, (route) =>
        AppMessage.ChangedRoute({ location: readLocation(route) }),
      ),
    ],
    head: () => [Head.titleTemplate((title) => `${title} · my.fm`), HtmlHead.lang("en")],
    view: (h, { route, search }) => {
      if (route._tag === "OAuthAuthorize") {
        return OAuthConsentPage(h, { key: search, props: { search } });
      }

      return h.div
        .class(
          "flex min-h-dvh w-full items-center justify-center sm:container sm:mx-auto sm:min-h-screen sm:max-w-md",
        )
        .children(
          h.main
            .class(
              "flex h-dvh w-full flex-col gap-6 overflow-x-hidden overflow-y-auto border-0 bg-card pt-[max(1.5rem,env(safe-area-inset-top))] pr-[env(safe-area-inset-right)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] text-card-foreground sm:h-168 sm:max-w-lg sm:overflow-hidden sm:rounded-xl sm:border sm:px-0 sm:py-6 sm:shadow-sm",
            )
            .children(route._tag !== "NotFound" && NotificationList(h, {}), ShellPage(h, route)),
        );
    },
  })
  .pipe(Component.provide(makeAuthFlowLayer(invalidateCurrentUser)));
