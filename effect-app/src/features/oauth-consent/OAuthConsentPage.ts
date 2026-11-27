import { Command, Component, Head, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { OAuthAuthorizeDetailsResponse, OAuthDecideInput } from "@my.fm/api";
import { Console, Effect, Layer, Schema } from "effect";

import { AuthFlow, requireUser } from "../auth/AuthErrorPage.ts";
import { onboardingPath } from "../onboarding/OnboardPage.ts";

const AUTHORIZE_PATH = "/oauth/authorize";
const Decision = OAuthDecideInput.fields.decision;

const requestError =
  "This authorization request is invalid or has expired. Start again from the connecting app.";

const decisionError =
  "Your decision could not be saved. Try again, or restart from the connecting app.";

export const OAuthConsentMessage = UiSchema.TaggedEnum({
  Loaded: { consent: OAuthAuthorizeDetailsResponse },
  InvalidRequest: {},
  FailedCheck: { error: Schema.String },
  Chose: { decision: Decision },
  FailedDecision: {},
  Navigated: {},
});

export class LoadConsent extends Command.Service<LoadConsent>()("oauth-consent/Load", {
  args: { search: Schema.String },
  success: OAuthConsentMessage,
}) {}

export class DecideConsent extends Command.Service<DecideConsent>()("oauth-consent/Decide", {
  args: OAuthDecideInput.fields,
  success: OAuthConsentMessage,
}) {}

const OAuthConsentCommands = Layer.mergeAll(
  LoadConsent.toLayer(
    Effect.gen(function* () {
      const auth = yield* AuthFlow;

      return ({ search }) =>
        Effect.gen(function* () {
          const returnTo = AUTHORIZE_PATH + search;
          const user = yield* requireUser(auth, returnTo);

          if (!user) return OAuthConsentMessage.Navigated();

          if (!user.onboarded) {
            yield* auth.navigate(onboardingPath(returnTo), "replace");

            return OAuthConsentMessage.Navigated();
          }

          return yield* auth.getConsent(Object.fromEntries(new URLSearchParams(search))).pipe(
            Effect.match({
              onSuccess: (consent) => OAuthConsentMessage.Loaded({ consent }),
              onFailure: () => OAuthConsentMessage.InvalidRequest(),
            }),
          );
        }).pipe(
          Effect.catch((error) =>
            Console.error(error).pipe(
              Effect.as(OAuthConsentMessage.FailedCheck({ error: error.message })),
            ),
          ),
        );
    }),
  ),
  DecideConsent.toLayer(
    Effect.gen(function* () {
      const auth = yield* AuthFlow;

      return (input) =>
        auth.decideConsent(input).pipe(
          Effect.flatMap(({ redirectTo }) => auth.assignLocation(redirectTo)),
          Effect.as(OAuthConsentMessage.Navigated()),
          Effect.orElseSucceed(() => OAuthConsentMessage.FailedDecision()),
        );
    }),
  ),
);

function detail(h: Html.H<typeof OAuthConsentMessage.Type>, label: string, value: string) {
  return h.div
    .class("space-y-1 p-3")
    .children(
      h.dt.class("text-xs font-medium text-muted-foreground").children(label),
      h.dd.class("font-mono text-xs break-all").children(value),
    );
}

const buttonClass =
  "inline-flex h-9 flex-1 items-center justify-center rounded-md px-4 text-sm font-medium transition-all duration-200 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50";

export const OAuthConsentPage = Html.component({
  name: "OAuthConsentPage",
  props: Schema.Struct({ search: Schema.String }),
  model: Schema.Struct({
    consent: Schema.NullOr(OAuthAuthorizeDetailsResponse),
    invalidRequest: Schema.Boolean,
    checkError: Schema.NullOr(Schema.String),
    decision: Schema.Literals(["idle", "pending", "failed"]),
  }),
  message: OAuthConsentMessage,
  restore: false,
})
  .make({
    init: ($) =>
      $.set({ consent: null, invalidRequest: false, checkError: null, decision: "idle" }).run(
        LoadConsent.make({ search: $.props.search }),
      ),
    update: {
      Loaded: ($, { consent }) => $.evolve({ consent }),
      InvalidRequest: ($) => $.evolve({ invalidRequest: true }),
      FailedCheck: ($, { error }) =>
        $.evolve({ checkError: error || "An unexpected error occurred." }),
      Chose: ($, { decision }) =>
        $.model.consent === null || $.model.decision === "pending"
          ? $.model
          : $.evolve({ decision: "pending" }).run(
              DecideConsent.make({ decision, query: $.props.search }),
            ),
      FailedDecision: ($) => $.evolve({ decision: "failed" }),
      Navigated: ($) => $.model,
    },
    head: () => [Head.title("Connect an app")],
    view: (h, { consent, invalidRequest, checkError, decision }) => {
      const error =
        checkError ??
        (invalidRequest ? requestError : decision === "failed" ? decisionError : null);

      const description = consent
        ? `${consent.client.clientName || "This app"} wants read-only access to your my.fm account.`
        : invalidRequest || checkError
          ? "Unable to connect this app."
          : "Checking your account…";

      return h.div
        .class(
          "flex min-h-dvh w-full items-center justify-center sm:mx-auto sm:min-h-screen sm:max-w-md",
        )
        .children(
          h.section
            .class(
              "flex h-dvh w-full flex-col gap-6 overflow-x-hidden overflow-y-auto bg-card pt-[max(1.5rem,env(safe-area-inset-top))] pr-[env(safe-area-inset-right)] pb-[env(safe-area-inset-bottom)] pl-[env(safe-area-inset-left)] text-card-foreground sm:h-auto sm:max-w-sm sm:overflow-hidden sm:rounded-xl sm:border sm:px-0 sm:py-6 sm:shadow-sm",
            )
            .children(
              h.header
                .class("grid auto-rows-min grid-rows-[auto_auto] gap-1.5 px-6")
                .children(
                  h.h1.class("text-3xl font-bold").children("Connect an app"),
                  h.p.class("mt-2 text-sm text-muted-foreground").children(description),
                ),
              h.div.class("flex flex-col gap-5 px-6").children(
                consent &&
                  h.dl
                    .class("divide-y rounded-lg border")
                    .children(
                      consent.client.clientUri && detail(h, "Website", consent.client.clientUri),
                      detail(h, "Redirects to", new URL(consent.redirectUri).origin),
                      URL.canParse(consent.client.clientId) &&
                        detail(h, "Client ID", consent.client.clientId),
                    ),
                consent &&
                  h.div
                    .class("space-y-1")
                    .children(
                      h.p.class("text-xs font-medium text-muted-foreground").children("Access"),
                      h.p
                        .class("text-sm")
                        .children(
                          "Read your profile, listening history and the public feed. No changes.",
                        ),
                    ),
                error &&
                  h.div
                    .attr("role", "alert")
                    .class(
                      "rounded-lg border border-danger-border bg-danger px-4 py-3 text-sm text-danger-foreground/70",
                    )
                    .children(error),
                consent &&
                  h.div.class("flex gap-3").children(
                    h.button
                      .attr("type", "button")
                      .class(
                        buttonClass,
                        "border bg-transparent shadow-xs hover:bg-accent hover:text-accent-foreground dark:hover:bg-accent/50",
                      )
                      .disabled(decision === "pending")
                      .on("click", OAuthConsentMessage.Chose({ decision: "deny" }))
                      .children("Deny"),
                    h.button
                      .attr("type", "button")
                      .class(
                        buttonClass,
                        "bg-primary text-primary-foreground shadow-xs hover:bg-primary/80",
                      )
                      .disabled(decision === "pending")
                      .on("click", OAuthConsentMessage.Chose({ decision: "allow" }))
                      .children("Allow"),
                  ),
              ),
            ),
        );
    },
  })
  .pipe(Component.provide(OAuthConsentCommands));
