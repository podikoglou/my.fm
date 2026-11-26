import { Command, Component, Head, Router, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Avatar } from "@effect/ui-kit/Avatar";
import { Button } from "@effect/ui-kit/Button";
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
  name: Schema.String,
  email: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  isPrivate: Schema.Boolean,
});

const Message = UiSchema.TaggedEnum({
  LoadedProfile: { profile: Profile },
  RequestedOnboarding: {},
  RequestedSignIn: {},
  FailedProfile: {},
  SavedPrivacy: { isPrivate: Schema.Boolean },
  ToggledEmail: {},
  RequestedSignOut: {},
  FailedSignOut: {},
});

const Model = UiSchema.TaggedEnum({
  Loading: {},
  Ready: {
    profile: Profile,
    emailVisible: Schema.Boolean,
    signOut: Schema.Literals(["idle", "pending", "failed"]),
  },
  Failed: {},
});

const settingsPath = AppRoute.print(AppRoute.Settings());

function initials(name: string) {
  const words = name.trim().split(/\s+/);

  return (
    words.length > 1 ? words.map((word) => word[0]).join("") : name.slice(0, 2)
  ).toUpperCase();
}

const LoadProfile = Command.make("settings/LoadProfile", { args: {} }, () =>
  Effect.gen(function* () {
    const session = yield* Effect.tryPromise(() => authClient.getSession());

    if (!session.data) return Message.RequestedSignIn();

    const user = yield* apiClient.user.me();

    if (!user.onboarded) return Message.RequestedOnboarding();

    const { id, username, name, email, avatarUrl, isPrivate } = user;

    return Message.LoadedProfile({ profile: { id, username, name, email, avatarUrl, isPrivate } });
  }).pipe(Effect.orElseSucceed(() => Message.RequestedSignIn())),
);

const SignIn = Command.make("settings/SignIn", { args: {} }, () =>
  Effect.tryPromise(() => signInWithSpotify(settingsPath)).pipe(
    Effect.match({ onSuccess: () => Component.noop, onFailure: () => Message.FailedProfile() }),
  ),
);

const SignOut = Command.make("settings/SignOut", { args: {} }, () =>
  Effect.tryPromise(async () => {
    const { error } = await authClient.signOut();

    if (error) throw new Error(error.message ?? "Sign-out failed.");

    window.location.replace(AppRoute.print(AppRoute.Feed()));
  }).pipe(
    Effect.match({ onSuccess: () => Component.noop, onFailure: () => Message.FailedSignOut() }),
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
    LoadedProfile: (_, { profile }) =>
      Model.Ready({ profile, emailVisible: false, signOut: "idle" }),
    RequestedOnboarding: ($) =>
      $.run(Router.replace(AppRoute, AppRoute.Onboard({})).pipe(Command.asNoop)),
    RequestedSignIn: ($) => $.run(SignIn.make()),
    FailedProfile: () => Model.Failed(),
    SavedPrivacy: ($, { isPrivate }) =>
      $.model._tag === "Ready"
        ? $.set(Model.Ready({ ...$.model, profile: { ...$.model.profile, isPrivate } })).emit(
            PrivacyEvents.SavedPrivacy({ isPrivate }),
          )
        : $.model,
    ToggledEmail: ($) =>
      $.model._tag === "Ready"
        ? Model.Ready({ ...$.model, emailVisible: !$.model.emailVisible })
        : $.model,
    RequestedSignOut: ($) =>
      $.model._tag === "Ready" && $.model.signOut !== "pending"
        ? $.set(Model.Ready({ ...$.model, signOut: "pending" })).run(SignOut.make())
        : $.model,
    FailedSignOut: ($) =>
      $.model._tag === "Ready" ? Model.Ready({ ...$.model, signOut: "failed" }) : $.model,
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
                .children(
                  h
                    .el("svg")
                    .attrs({
                      "aria-hidden": "true",
                      class: "size-4",
                      viewBox: "0 0 24 24",
                      fill: "none",
                      stroke: "currentColor",
                      "stroke-width": "2",
                      "stroke-linecap": "round",
                      "stroke-linejoin": "round",
                    })
                    .children(h.el("path").attr("d", "m12 19-7-7 7-7M19 12H5")),
                  "Back",
                )
            : null,
        ),
        model._tag === "Ready"
          ? h.div.class("settings-content").children(
              h.section(
                h.h2("Account"),
                h.div.class("settings-group settings-row settings-account").children(
                  h.div.class("settings-account-identity").children(
                    Avatar(h, {
                      props: { src: model.profile.avatarUrl ?? undefined },
                      view: (avatar) =>
                        avatar
                          .root(h.span.class("settings-account-avatar"))
                          .children(
                            avatar.image(h.img.attr("alt", "")),
                            avatar.fallback(h.span)?.children(initials(model.profile.name)),
                          ),
                    }),
                    h.div.class("settings-account-details").children(
                      h.strong(model.profile.name),
                      h.p(`@${model.profile.username}`),
                      h.button
                        .attr("type", "button")
                        .class(model.emailVisible ? "settings-email" : "settings-email masked")
                        .attr("aria-label", model.emailVisible ? undefined : "Reveal email")
                        .attr(
                          "title",
                          model.emailVisible ? "Click to hide email" : "Click to reveal email",
                        )
                        .on("click", Message.ToggledEmail())
                        .children(model.emailVisible ? model.profile.email : null),
                      h.div
                        .attr("role", "status")
                        .class("settings-error")
                        .children(
                          model.signOut === "failed" ? "Could not sign out. Try again." : null,
                        ),
                    ),
                  ),
                  Button(h, {
                    props: {
                      disabled: model.signOut === "pending",
                      focusableWhenDisabled: true,
                    },
                    onPress: Message.RequestedSignOut(),
                  })
                    .class("settings-button")
                    .children(model.signOut === "pending" ? "Signing out..." : "Sign out"),
                ),
              ),
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
