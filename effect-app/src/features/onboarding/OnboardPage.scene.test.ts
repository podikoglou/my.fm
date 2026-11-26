import { test } from "node:test";

import { HtmlCommand } from "@effect/ui/html";
import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator } from "@effect/ui/testing";
import { Effect } from "effect";

import { CheckOnboarding, OnboardMessage, OnboardPage, SubmitOnboarding } from "./OnboardPage.ts";

const consent = "/oauth/authorize?client_id=example&state=a%2Bb%26c";
const form = HtmlLocator.role("form", { name: "Onboarding" });

void test("waits for auth and validates the form before submitting back to the original OAuth request", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scene = yield* HtmlScene.make(OnboardPage, { returnTo: consent });
      const name = HtmlLocator.label("Name");
      const username = HtmlLocator.label("Username");

      scene
        .expectExact(
          CheckOnboarding.make({
            callbackURL: "/onboard?" + new URLSearchParams({ returnTo: consent }),
            returnTo: consent,
          }),
        )
        .expect(form)
        .toBeAbsent()
        .resolve(CheckOnboarding, OnboardMessage.Ready())
        .submit(form)
        .expect(Locator.text("Name must be at least 1 character"))
        .toExist()
        .expect(Locator.text("Username must be at least 3 characters"))
        .toExist()
        .resolve(HtmlCommand.Focus, { found: true })
        .type(name, "  Alex  ")
        .type(username, "alex_1")
        .submit(form)
        .expectExact(
          SubmitOnboarding.make({ input: { name: "Alex", username: "alex_1" }, returnTo: consent }),
        )
        .resolve(SubmitOnboarding, OnboardMessage.Navigated());
    }).pipe(Effect.scoped),
  ));

void test("does not send an already-onboarded user to an external return path", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const returnTo = "/a/..//other.example/path";
      const scene = yield* HtmlScene.make(OnboardPage, { returnTo });

      scene
        .expectExact(
          CheckOnboarding.make({
            callbackURL: "/onboard?" + new URLSearchParams({ returnTo }),
            returnTo: "/",
          }),
        )
        .resolve(CheckOnboarding, OnboardMessage.Navigated())
        .expect(form)
        .toBeAbsent();
    }).pipe(Effect.scoped),
  ));
