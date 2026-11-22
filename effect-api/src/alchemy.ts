import * as Cloudflare from "@alchemy.run/cloudflare";
import { Effect, Layer } from "effect";
import { HttpRouter } from "effect/http";

import { Db } from "./db/service.ts";
import { HttpAppLayer } from "./http/app.ts";
import { RateLimiter } from "./rate-limit/service.ts";
import { RATE_LIMITS, type RateLimitBindingName } from "./rate-limits.ts";
import { ImportsStorage } from "./storage/service.ts";

export const EffectDatabase = Cloudflare.D1.Database("EffectDatabase");
export const EffectImportsBucket = Cloudflare.R2.Bucket("EffectImportsBucket");
export const EffectOAuthKv = Cloudflare.KV.Namespace("EffectOAuthKv");

function rateLimitResource(name: RateLimitBindingName) {
  const { namespaceId, limit, period } = RATE_LIMITS[name];

  return Cloudflare.Workers.RateLimit(name, { namespaceId, simple: { limit, period } });
}

export const AuthRateLimit = rateLimitResource("AUTH_RATE_LIMIT");
export const PublicReadRateLimit = rateLimitResource("PUBLIC_READ_RATE_LIMIT");

/**
 * Effectful Alchemy Cloudflare Worker definition.
 *
 * The outer Effect binds Cloudflare resources (D1, R2, rate limits) at deploy
 * and cold-start time. The inner `fetch` Effect resolves request-scoped
 * bindings from `RuntimeContext` into typed Effect service Layers (`Db`,
 * `ImportsStorage`, `RateLimiter`). Not yet wired into root `alchemy.run.ts`
 * until PR 7 cutover.
 */
export class EffectApiWorker extends Cloudflare.Workers.Worker<EffectApiWorker>()(
  "EffectApiWorker",
  {
    main: import.meta.url,
    compatibility: { date: "2026-11-02", flags: ["global_fetch_strictly_public"] },
    cache: { enabled: true },
    observability: { enabled: true, issues: { enabled: true } },
  },
  Effect.gen(function* () {
    const dbClient = yield* Cloudflare.D1.QueryDatabase(EffectDatabase);
    const importsBucket = yield* Cloudflare.R2.ReadWriteBucket(EffectImportsBucket);
    // The module-scope values from `rateLimitResource` are already the
    // binding values: yield them directly. Re-calling the constructor with the
    // binding as its `name` arg crashes, since `props` is then undefined.
    const authLimiter = yield* AuthRateLimit;
    const publicReadLimiter = yield* PublicReadRateLimit;

    return {
      fetch: Effect.gen(function* () {
        const rawDb = yield* dbClient.raw;
        const rawBucket = yield* importsBucket.raw;
        const rawAuthLimiter = yield* authLimiter.raw;
        const rawPublicReadLimiter = yield* publicReadLimiter.raw;

        const infraLayer = Layer.mergeAll(
          Db.layerFromBinding(rawDb),
          ImportsStorage.layerFromBinding(rawBucket),
          RateLimiter.layerFromBindings({
            AUTH_RATE_LIMIT: rawAuthLimiter,
            PUBLIC_READ_RATE_LIMIT: rawPublicReadLimiter,
          }),
        );

        const httpEffect = yield* HttpRouter.toHttpEffect(
          HttpAppLayer.pipe(Layer.provide(infraLayer)),
        );

        return yield* httpEffect;
      }).pipe(Effect.scoped),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.Workers.RateLimitBinding,
      ),
    ),
  ),
) {}
