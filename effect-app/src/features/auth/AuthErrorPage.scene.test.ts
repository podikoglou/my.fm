import { test } from "node:test";

import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator } from "@effect/ui/testing";
import { Effect } from "effect";

import { AuthErrorMessage, AuthErrorPage, RetrySpotifySignIn } from "./AuthErrorPage.ts";

void test("explains the Spotify error, bounds the description, and unlocks a failed retry", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const description = "a".repeat(200);

      const scene = yield* HtmlScene.make(AuthErrorPage, {
        error: "access_denied",
        error_description: description + "extra",
      });

      const retry = HtmlLocator.role("button", { name: "Try again" });

      scene
        .expect(Locator.text("You cancelled the sign-in on Spotify."))
        .toExist()
        .expect(Locator.text("Error code: access_denied"))
        .toExist()
        .expect(Locator.text(description + "…"))
        .toExist()
        .click(retry)
        .expectExact(RetrySpotifySignIn.make({}))
        .expect(retry)
        .toBeDisabled()
        .resolve(RetrySpotifySignIn, AuthErrorMessage.FailedSignIn())
        .expect(retry)
        .toBeDisabled(false);
    }).pipe(Effect.scoped),
  ));
