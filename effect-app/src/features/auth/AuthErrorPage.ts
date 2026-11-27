import type {
  OAuthAuthorizeDetailsResponse,
  OAuthDecideInput,
  OAuthDecideResponse,
  OnboardInput,
  SessionUserSchema,
} from "@my.fm/api";
import { Command, Component, Head, Router, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Console, Context, Effect, Layer, Schema } from "effect";

import { apiClient } from "../../lib/api.ts";
import { authClient, signInWithSpotify } from "../../lib/auth.ts";

type CurrentUser = Pick<typeof SessionUserSchema.Type, "onboarded">;

export class AuthFlow extends Context.Service<
  AuthFlow,
  {
    readonly hasSession: Effect.Effect<boolean, Error>;
    readonly currentUser: Effect.Effect<CurrentUser, Error>;
    readonly signInWithSpotify: (callbackURL: string) => Effect.Effect<void, Error>;
    readonly onboard: (input: typeof OnboardInput.Type) => Effect.Effect<void, Error>;
    readonly invalidateCurrentUser: Effect.Effect<void>;
    readonly getConsent: (
      query: Readonly<Record<string, string>>,
    ) => Effect.Effect<typeof OAuthAuthorizeDetailsResponse.Type, Error>;
    readonly decideConsent: (
      input: typeof OAuthDecideInput.Type,
    ) => Effect.Effect<typeof OAuthDecideResponse.Type, Error>;
    readonly navigate: (path: string, history: "push" | "replace") => Effect.Effect<void>;
    readonly assignLocation: (url: string) => Effect.Effect<void>;
  }
>()("my.fm/auth/AuthFlow") {}

function apiError(error: Error | { readonly error: string }) {
  return error instanceof Error ? error : new Error(error.error);
}

export const makeAuthFlowLayer = (invalidateCurrentUser: Effect.Effect<void>) =>
  Layer.effect(
    AuthFlow,
    Effect.gen(function* () {
      const router = yield* Router.Router;

      return AuthFlow.of({
        hasSession: Effect.tryPromise(() => authClient.getSession()).pipe(
          Effect.map(({ data }) => data !== null),
        ),
        currentUser: apiClient.user.me().pipe(Effect.mapError(apiError)),
        signInWithSpotify: (callbackURL) => Effect.tryPromise(() => signInWithSpotify(callbackURL)),
        onboard: (payload) =>
          apiClient.user.onboard({ payload }).pipe(Effect.asVoid, Effect.mapError(apiError)),
        invalidateCurrentUser,
        getConsent: (query) =>
          apiClient.oauth.getAuthorize({ query }).pipe(Effect.mapError(apiError)),
        decideConsent: (payload) =>
          apiClient.oauth.decideAuthorize({ payload }).pipe(Effect.mapError(apiError)),
        navigate: (path, history) =>
          router.navigate(path, { replace: history === "replace" }).pipe(Effect.asVoid),
        assignLocation: (url) => Effect.sync(() => window.location.assign(url)),
      });
    }),
  );

export const requireUser = Effect.fnUntraced(function* (
  auth: AuthFlow["Service"],
  callbackURL: string,
) {
  if (!(yield* auth.hasSession)) {
    yield* auth.signInWithSpotify(callbackURL);

    return null;
  }

  return yield* auth.currentUser.pipe(
    Effect.catch((error) =>
      Console.error(error).pipe(
        Effect.andThen(auth.signInWithSpotify(callbackURL)),
        Effect.as(null),
      ),
    ),
  );
});

function describeAuthError(code?: string) {
  switch (code) {
    case "access_denied":
      return "You cancelled the sign-in on Spotify.";
    case "unable_to_get_user_info":
      return "Spotify did not send back your profile. Spotify is most likely rate limiting us, so try again in a few minutes.";
    case "invalid_code":
      return "Spotify rejected the sign-in attempt. Try again.";
    case "email_not_found":
      return "Spotify did not share an email address for your account.";
    case "state_mismatch":
      return "The sign-in session expired. Try again.";
    default:
      return "We could not sign you in with Spotify.";
  }
}

const MAX_DESCRIPTION_LENGTH = 200;

export const AuthErrorMessage = UiSchema.TaggedEnum({
  Retried: {},
  StartedSignIn: {},
  FailedSignIn: {},
});

export class RetrySpotifySignIn extends Command.Service<RetrySpotifySignIn>()(
  "auth/RetrySpotifySignIn",
  { args: {}, success: AuthErrorMessage },
) {}

const AuthErrorCommands = RetrySpotifySignIn.toLayer(
  Effect.gen(function* () {
    const auth = yield* AuthFlow;

    return () =>
      auth.signInWithSpotify("/").pipe(
        Effect.as(AuthErrorMessage.StartedSignIn()),
        Effect.catch((error) =>
          Console.error(error).pipe(Effect.as(AuthErrorMessage.FailedSignIn())),
        ),
      );
  }),
);

export const AuthErrorPage = Html.component({
  name: "AuthErrorPage",
  props: Schema.Struct({
    error: Schema.optional(Schema.String),
    error_description: Schema.optional(Schema.String),
  }),
  model: Schema.Struct({ pending: Schema.Boolean }),
  message: AuthErrorMessage,
  restore: false,
})
  .make({
    init: () => ({ pending: false }),
    update: {
      Retried: ($) =>
        $.model.pending ? $.model : $.evolve({ pending: true }).run(RetrySpotifySignIn.make({})),
      StartedSignIn: ($) => $.model,
      FailedSignIn: ($) => $.evolve({ pending: false }),
    },
    head: () => [Head.title("Sign-in failed")],
    view: (h, model) => {
      const { error, error_description: description = "" } = h.props;
      const excerpt = description.slice(0, MAX_DESCRIPTION_LENGTH);

      return h.div
        .class("flex w-full flex-col gap-6 sm:w-96")
        .children(
          h.header
            .class("px-6")
            .children(
              h.h1.class("text-3xl font-bold").children("Sign-in failed"),
              h.p.class("mt-2 text-sm text-muted-foreground").children(describeAuthError(error)),
            ),
          h.div
            .class("flex flex-col gap-4 px-6")
            .children(
              excerpt !== "" &&
                h.p
                  .class("text-sm break-words text-muted-foreground")
                  .children(excerpt + (excerpt.length < description.length ? "…" : "")),
              h.button
                .attr("type", "button")
                .class(
                  "h-9 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/80 disabled:opacity-50",
                )
                .disabled(model.pending)
                .on("click", AuthErrorMessage.Retried())
                .children("Try again"),
              error
                ? h.p.class("text-xs text-muted-foreground").children(`Error code: ${error}`)
                : null,
            ),
        );
    },
  })
  .pipe(Component.provide(AuthErrorCommands));
