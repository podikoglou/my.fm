import { test } from "node:test";

import { HtmlLocator, HtmlScene } from "@effect/ui/html/testing";
import { Locator } from "@effect/ui/testing";
import { Effect } from "effect";

import {
  DecideConsent,
  LoadConsent,
  OAuthConsentMessage,
  OAuthConsentPage,
} from "./OAuthConsentPage.ts";

const search = "?client_id=client&state=a%2Bb%26c&code_challenge=challenge";
const allow = HtmlLocator.role("button", { name: "Allow" });
const deny = HtmlLocator.role("button", { name: "Deny" });
const alert = HtmlLocator.role("alert");

void test("keeps the raw query for either decision and unlocks controls on failure", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scene = yield* HtmlScene.make(OAuthConsentPage, { search });

      const consent = {
        client: { clientId: "https://client.example/metadata", clientName: "Example" },
        redirectUri: "https://client.example/callback?detail=private",
        scope: ["read"],
      };

      scene
        .expectExact(LoadConsent.make({ search }))
        .expect(allow)
        .toBeAbsent()
        .resolve(LoadConsent, OAuthConsentMessage.Loaded({ consent }))
        .expect(Locator.text("Example wants read-only access to your my.fm account."))
        .toExist()
        .expect(Locator.text("https://client.example"))
        .toExist()
        .click(allow)
        .expectExact(DecideConsent.make({ decision: "allow", query: search }))
        .expect(allow)
        .toBeDisabled()
        .expect(deny)
        .toBeDisabled()
        .resolve(DecideConsent, OAuthConsentMessage.FailedDecision())
        .expect(alert)
        .toHaveText(/Your decision could not be saved/)
        .click(deny)
        .expectExact(DecideConsent.make({ decision: "deny", query: search }))
        .resolve(DecideConsent, OAuthConsentMessage.Navigated());
    }).pipe(Effect.scoped),
  ));

void test("does not offer a decision for an invalid authorization request", () =>
  Effect.runPromise(
    Effect.gen(function* () {
      const scene = yield* HtmlScene.make(OAuthConsentPage, { search });

      scene
        .resolve(LoadConsent, OAuthConsentMessage.InvalidRequest())
        .expect(alert)
        .toHaveText(/invalid or has expired/)
        .expect(allow)
        .toBeAbsent()
        .expect(deny)
        .toBeAbsent();
    }).pipe(Effect.scoped),
  ));
