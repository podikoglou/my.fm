import { Command, Component, Head, Router, Subscription, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Cause, Effect, Option, Schema, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";

import { signInWithSpotify } from "../../lib/auth";
import { AppRoute } from "../../routes";
import { profileIcon } from "./icons";
import { ProfileErrorCard } from "./ProfileErrorCard";
import { GetUserByUsername, GetViewer, ProfileSession } from "./queries";
import { UserAvatar } from "./UserAvatar";
import { UserTrackList } from "./UserTrackList";

export const SignInWithSpotify = Command.make(
  "SignInWithSpotify",
  {
    args: { callbackURL: Schema.String },
    mode: "switch",
  },
  ({ callbackURL }) =>
    Effect.tryPromise(() => signInWithSpotify(callbackURL)).pipe(
      Effect.ignore,
      Effect.as(Component.noop),
    ),
);

export const InvalidateViewer = Command.make(
  "InvalidateViewer",
  {
    args: {},
    mode: "switch",
  },
  () => GetViewer.invalidate({}).pipe(Effect.as(Component.noop)),
);

export const ProfilePageProps = Schema.Struct({
  username: Schema.String,
});

export const ProfilePageMessage = UiSchema.TaggedEnum({
  ClickedSignIn: {},
  CheckedViewer: { needsOnboarding: Schema.Boolean },
  ChangedSession: { userId: Schema.NullOr(Schema.String) },
});

const ghostButtonClasses =
  "inline-flex shrink-0 items-center justify-center rounded-md text-sm font-medium whitespace-nowrap transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 text-foreground hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50";

export const ProfilePageNoDeps = Html.component({
  name: "ProfilePage",
  props: ProfilePageProps,
  model: Schema.Struct({
    hasSession: Schema.Boolean,
    sessionUserId: Schema.NullOr(Schema.String),
  }),
  message: ProfilePageMessage,
  restore: false,
  queries: {
    profile: {
      query: GetUserByUsername,
      args: ({ props }) => ({ username: props.username }),
    },
    viewer: {
      query: GetViewer,
      args: () => ({}),
      onChange: (result) =>
        ProfilePageMessage.CheckedViewer({
          needsOnboarding:
            AsyncResult.isSuccess(result) &&
            result.value._tag === "SignedIn" &&
            !result.value.user.onboarded,
        }),
    },
  },
}).make({
  init: () => ({ hasSession: false, sessionUserId: null }),
  update: {
    ClickedSignIn: ($) =>
      $.run(
        SignInWithSpotify.make({
          callbackURL: AppRoute.print(AppRoute.User({ params: { username: $.props.username } })),
        }),
      ),
    CheckedViewer: ($, { needsOnboarding }) =>
      needsOnboarding
        ? $.run(Router.replace(AppRoute, AppRoute.Onboard({ search: {} })).pipe(Command.asNoop))
        : $,
    ChangedSession: ($, { userId }) => {
      if (!$.model.hasSession) {
        return { hasSession: true, sessionUserId: userId };
      }

      if (userId === $.model.sessionUserId) return $.model;

      return $.set({ hasSession: true, sessionUserId: userId }).run(InvalidateViewer.make({}));
    },
  },
  subscriptions: () => [
    Subscription.make(
      "session",
      Stream.unwrap(Effect.map(ProfileSession, ({ changes }) => changes)).pipe(
        Stream.map((userId) => ProfilePageMessage.ChangedSession({ userId })),
      ),
    ),
  ],
  head: ({ props, queries }) => [
    Head.title(
      AsyncResult.isSuccess(queries.profile) ? queries.profile.value.name : `@${props.username}`,
    ),
  ],
  view: (h) => {
    const viewer = AsyncResult.isSuccess(h.queries.viewer) ? h.queries.viewer.value : undefined;

    if (viewer?._tag === "SignedIn" && !viewer.user.onboarded) {
      return h.div.class("contents");
    }

    return AsyncResult.match(h.queries.profile, {
      onInitial: () => h.div.class("contents"),
      onFailure: ({ cause }) => {
        const lookupError = Option.getOrUndefined(Cause.findErrorOption(cause));

        return lookupError === "private"
          ? ProfileErrorCard(h, "lock", "Private Profile", "This user's profile is private")
          : ProfileErrorCard(
              h,
              "userX",
              "User Not Found",
              "The user you're looking for does not exist",
            );
      },
      onSuccess: ({ value: profile }) =>
        h.div.class("contents").children(
          h.div
            .attr("data-slot", "card-header")
            .class("@container/card-header relative flex flex-col items-center gap-4 px-6")
            .children(
              viewer?._tag === "SignedIn" &&
                viewer.user.id === profile.id &&
                h.a
                  .attrs({
                    href: AppRoute.print(AppRoute.Settings()),
                    "aria-label": "Settings",
                    class: `${ghostButtonClasses} absolute top-0 right-2 size-8 gap-2 [&_svg:not([class*='size-'])]:size-3`,
                  })
                  .children(profileIcon(h, "settings", "size-4")),
              viewer?._tag === "Anonymous" &&
                h.button
                  .attrs({
                    type: "button",
                    "data-slot": "button",
                    class: `${ghostButtonClasses} absolute top-0 right-2 h-8 gap-1 px-3`,
                  })
                  .disabled(h.isRunning(SignInWithSpotify))
                  .on("click", ProfilePageMessage.ClickedSignIn())
                  .children("Sign in"),
              UserAvatar(h, { avatarUrl: profile.avatarUrl, name: profile.name }),
              h.div
                .class("space-y-1 text-center")
                .children(
                  h.h1.class("text-3xl font-bold").children(profile.name),
                  h.p.class("text-sm text-muted-foreground").children(`@${profile.username}`),
                ),
            ),
          h.div
            .attr("data-slot", "card-content")
            .class("min-h-0 flex-1 overflow-hidden px-6")
            .children(
              UserTrackList(h, {
                key: h.props.username,
                props: { username: h.props.username },
              }),
            ),
        ),
    });
  },
});

export const ProfilePage = ProfilePageNoDeps.pipe(
  Component.provide([GetUserByUsername.layer, GetViewer.layer, ProfileSession.layer]),
);
