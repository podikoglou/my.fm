import * as Alchemy from "alchemy";
import * as Config from "effect/Config";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";

/**
 * Custom hostname of the current stage's website, from the deploy environment,
 * so each deployment names a domain it owns. `alchemy deploy` names the live
 * stage `live_$USER` by default. Other stages have no domain and serve their
 * `workers.dev` URL. Any hostname attached outside Alchemy stays unmanaged.
 */
export const StageDomain = Effect.gen(function* () {
  const stage = yield* Alchemy.Stage;

  const variable =
    stage === "preview"
      ? "WEBSITE_DOMAIN_PREVIEW"
      : stage === "live" || stage.startsWith("live_")
        ? "WEBSITE_DOMAIN_LIVE"
        : null;

  if (variable === null) {
    return Option.none<string>();
  }

  return yield* Effect.orDie(Config.String(variable).pipe(Config.option));
});
