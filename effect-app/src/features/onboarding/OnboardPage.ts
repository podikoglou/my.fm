import { Command, Component, UiSchema } from "@effect/ui";
import { Html, HtmlCommand } from "@effect/ui/html";
import { OnboardInput } from "@my.fm/api";
import { Console, Effect, Layer, Result, Schema, SchemaIssue } from "effect";

import { AuthFlow, requireUser } from "../auth/AuthErrorPage.ts";

export const ONBOARD_PATH = "/onboard";

export function onboardingPath(returnTo: string) {
  return ONBOARD_PATH + "?" + new URLSearchParams({ returnTo });
}

function safeReturnPath(returnTo?: string) {
  const base = "https://my.fm";

  if (!returnTo?.startsWith("/") || returnTo.startsWith("//") || !URL.canParse(returnTo, base)) {
    return "/";
  }

  const target = new URL(returnTo, base);

  return target.origin === base && !target.pathname.startsWith("//")
    ? target.pathname + target.search
    : "/";
}

const Fields = Schema.Struct({ name: Schema.String, username: Schema.String });

type Field = keyof typeof Fields.Type;

const fieldRefs = {
  name: Html.ref("OnboardingName", "input"),
  username: Html.ref("OnboardingUsername", "input"),
};

const decodeForm = Schema.decodeResult(OnboardInput, { errors: "all" });
const formatIssues = SchemaIssue.makeFormatterStandardSchemaV1();

export const OnboardMessage = UiSchema.TaggedEnum({
  ChangedField: { field: Schema.Literals(["name", "username"]), value: Schema.String },
  Submitted: {},
  Ready: {},
  FailedCheck: { error: Schema.String },
  FocusedField: {},
  Navigated: {},
  Failed: {},
});

export class CheckOnboarding extends Command.Service<CheckOnboarding>()("onboarding/Check", {
  args: { callbackURL: Schema.String, returnTo: Schema.String },
  success: OnboardMessage,
}) {}

export class SubmitOnboarding extends Command.Service<SubmitOnboarding>()("onboarding/Submit", {
  args: { input: Schema.toType(OnboardInput), returnTo: Schema.String },
  success: OnboardMessage,
}) {}

const OnboardCommands = Layer.mergeAll(
  CheckOnboarding.toLayer(
    Effect.gen(function* () {
      const auth = yield* AuthFlow;

      return ({ callbackURL, returnTo }) =>
        Effect.gen(function* () {
          const user = yield* requireUser(auth, callbackURL);

          if (user?.onboarded) {
            yield* auth.navigate(returnTo, "replace");

            return OnboardMessage.Navigated();
          }

          return OnboardMessage.Ready();
        }).pipe(
          Effect.catch((error) =>
            Console.error(error).pipe(
              Effect.as(OnboardMessage.FailedCheck({ error: error.message })),
            ),
          ),
        );
    }),
  ),
  SubmitOnboarding.toLayer(
    Effect.gen(function* () {
      const auth = yield* AuthFlow;

      return ({ input, returnTo }) =>
        auth.onboard(input).pipe(
          Effect.andThen(auth.invalidateCurrentUser),
          Effect.andThen(auth.navigate(returnTo, "push")),
          Effect.as(OnboardMessage.Navigated()),
          Effect.catch((error) => Console.error(error).pipe(Effect.as(OnboardMessage.Failed()))),
        );
    }),
  ),
);

const inputClass =
  "h-9 w-full rounded-md border bg-input px-3 py-1 text-base shadow-xs transition-[color,box-shadow,border-color] outline-none hover:border-ring/70 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/50 md:text-sm";

function formField(
  h: Html.H<typeof OnboardMessage.Type>,
  field: Field,
  label: string,
  value: string,
  placeholder: string,
  error?: string,
) {
  return h.div.class("flex flex-col gap-2").children(
    h.label
      .attr("for", field)
      .class("text-sm leading-none font-medium select-none", error && "text-destructive")
      .children(label),
    h.input
      .ref(fieldRefs[field])
      .attr("id", field)
      .attr("name", field)
      .attr("placeholder", placeholder)
      .attr("aria-invalid", error ? "true" : "false")
      .attr("aria-describedby", error ? `${field}-error` : undefined)
      .class(inputClass)
      .value(value)
      .on("input", ({ value: text }) => OnboardMessage.ChangedField({ field, value: text })),
    error && h.p.attr("id", `${field}-error`).class("text-sm text-destructive").children(error),
  );
}

export const OnboardPage = Html.component({
  name: "OnboardPage",
  props: Schema.Struct({ returnTo: Schema.optional(Schema.String) }),
  model: Schema.Struct({
    fields: Fields,
    submitted: Schema.Boolean,
    ready: Schema.Boolean,
    checkError: Schema.NullOr(Schema.String),
  }),
  message: OnboardMessage,
  restore: false,
})
  .make({
    init: ($) =>
      $.set({
        fields: { name: "", username: "" },
        submitted: false,
        ready: false,
        checkError: null,
      }).run(
        CheckOnboarding.make({
          callbackURL:
            $.props.returnTo === undefined ? ONBOARD_PATH : onboardingPath($.props.returnTo),
          returnTo: safeReturnPath($.props.returnTo),
        }),
      ),
    update: {
      ChangedField: ($, { field, value }) =>
        $.evolve({ fields: { ...$.model.fields, [field]: value } }),
      Submitted: ($) => {
        const validated = decodeForm($.model.fields);
        const next = $.evolve({ submitted: true });

        if (Result.isSuccess(validated)) {
          return next.run(
            SubmitOnboarding.make({
              input: validated.success,
              returnTo: safeReturnPath($.props.returnTo),
            }),
          );
        }

        const issues = formatIssues(validated.failure.issue).issues;
        const firstInvalid = issues.some(({ path }) => path?.[0] === "name") ? "name" : "username";

        return next.run(
          HtmlCommand.focus(fieldRefs[firstInvalid], () => OnboardMessage.FocusedField()),
        );
      },
      Ready: ($) => $.evolve({ ready: true }),
      FailedCheck: ($, { error }) =>
        $.evolve({ checkError: error || "An unexpected error occurred." }),
      FocusedField: ($) => $.model,
      Navigated: ($) => $.model,
      Failed: ($) => $.model,
    },
    view: (h, { fields, submitted, ready, checkError }) => {
      if (checkError) {
        return h.div
          .attr("role", "alert")
          .class("flex flex-col gap-2 px-6")
          .children(
            h.h1.class("text-3xl font-bold").children("Something went wrong"),
            h.p.class("text-sm text-muted-foreground").children(checkError),
          );
      }

      if (!ready) return h.div.attr("hidden", "");

      const validated = submitted ? decodeForm(fields) : undefined;

      const issues =
        validated && Result.isFailure(validated)
          ? formatIssues(validated.failure.issue).issues
          : [];

      const errorFor = (field: Field) => issues.find(({ path }) => path?.[0] === field)?.message;

      return h.div.class("flex w-full flex-col gap-6 sm:w-96").children(
        h.header
          .class("px-6")
          .children(
            h.h1.class("text-3xl font-bold").children("One more thing..."),
            h.p
              .class("mt-2 text-sm text-muted-foreground")
              .children("We need some more information about you to know you better."),
          ),
        h.form
          .attr("aria-label", "Onboarding")
          .attr("novalidate", "")
          .class("flex flex-col gap-4 px-6")
          .on("submit", OnboardMessage.Submitted())
          .children(
            formField(h, "name", "Name", fields.name, "kyle", errorFor("name")),
            formField(h, "username", "Username", fields.username, "kyles", errorFor("username")),
            h.button
              .attr("type", "submit")
              .class(
                "inline-flex h-9 items-center justify-center rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground shadow-xs transition-all duration-200 outline-none hover:bg-primary/80 focus-visible:ring-[3px] focus-visible:ring-ring/50",
              )
              .children("Submit"),
          ),
      );
    },
  })
  .pipe(Component.provide(OnboardCommands));
