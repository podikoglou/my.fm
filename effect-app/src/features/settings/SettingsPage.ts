import { Command, Component, Head, Router, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Schema } from "effect";

import { apiClient } from "../../lib/api";
import { authClient, signInWithSpotify } from "../../lib/auth";
import { AppRoute } from "../../routes";
import { AppearanceSettings } from "./AppearanceSettings";
import { ConnectedAppsSettings } from "./ConnectedAppsSettings";
import { ImportSettings } from "./ImportSettings";
import { PrivacyEvents, PrivacySettings } from "./PrivacySettings";
import "./settings.css";

const Profile = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  isPrivate: Schema.Boolean,
});

const Message = UiSchema.TaggedEnum({
  LoadedProfile: { profile: Profile },
  RequestedOnboarding: {},
  RequestedSignIn: {},
  FailedProfile: {},
  SavedPrivacy: { isPrivate: Schema.Boolean },
});

const Model = UiSchema.TaggedEnum({
  Loading: {},
  Ready: { profile: Profile },
  Failed: {},
});

const settingsPath = AppRoute.print(AppRoute.Settings());

const LoadProfile = Command.make("settings/LoadProfile", { args: {} }, () =>
  Effect.gen(function* () {
    const session = yield* Effect.tryPromise(() => authClient.getSession());

    if (session.error) return Message.FailedProfile();

    if (!session.data) return Message.RequestedSignIn();

    const user = yield* apiClient.user.me();

    return user.onboarded
      ? Message.LoadedProfile({
          profile: { id: user.id, username: user.username, isPrivate: user.isPrivate },
        })
      : Message.RequestedOnboarding();
  }).pipe(Effect.orElseSucceed(() => Message.FailedProfile())),
);

const SignIn = Command.make("settings/SignIn", { args: {} }, () =>
  Effect.tryPromise(() => signInWithSpotify(settingsPath)).pipe(
    Effect.match({ onSuccess: () => Component.noop, onFailure: () => Message.FailedProfile() }),
  ),
);

export const SettingsPage = Html.component({
  name: "SettingsPage",
  props: Schema.Struct({}),
  model: Model,
  message: Message,
  events: PrivacyEvents,
  restore: false,
}).make({
  init: ($) => $.set(Model.Loading()).run(LoadProfile.make()),
  update: {
    LoadedProfile: (_, { profile }) => Model.Ready({ profile }),
    RequestedOnboarding: ($) =>
      $.run(
        Router.replace(AppRoute, AppRoute.Onboard({ search: { returnTo: settingsPath } })).pipe(
          Command.asNoop,
        ),
      ),
    RequestedSignIn: ($) => $.run(SignIn.make()),
    FailedProfile: () => Model.Failed(),
    SavedPrivacy: ($, { isPrivate }) =>
      $.model._tag === "Ready"
        ? $.set(Model.Ready({ profile: { ...$.model.profile, isPrivate } })).emit(
            PrivacyEvents.SavedPrivacy({ isPrivate }),
          )
        : $.model,
  },
  head: () => [Head.title("Settings")],
  view: (h, model) =>
    h.section
      .class("settings-page flex min-h-0 min-w-0 flex-1 flex-col gap-6 px-6")
      .attr("aria-labelledby", "settings-title")
      .children(
        h.header(
          h.div(
            h.h1.attr("id", "settings-title").children("Settings"),
            h.p("Manage your profile and account."),
          ),
          model._tag === "Ready"
            ? h.a
                .class("settings-back")
                .attr(
                  "href",
                  AppRoute.print(AppRoute.User({ params: { username: model.profile.username } })),
                )
                .children(h.span.attr("aria-hidden", "true").children("← "), "Back")
            : null,
        ),
        model._tag === "Ready"
          ? h.div.class("settings-content").children(
              PrivacySettings(h, {
                props: { isPrivate: model.profile.isPrivate },
                onEmit: { SavedPrivacy: Message.SavedPrivacy },
              }),
              AppearanceSettings(h, {}),
              ImportSettings(h, { props: { userId: model.profile.id } }),
              ConnectedAppsSettings(h, { props: { userId: model.profile.id } }),
            )
          : h.p
              .attr("role", "status")
              .children(
                model._tag === "Loading"
                  ? "Loading settings..."
                  : "Could not load your settings. Please try again.",
              ),
      ),
});
