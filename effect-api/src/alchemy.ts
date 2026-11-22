import * as Cloudflare from "@alchemy.run/cloudflare";
import * as Alchemy from "alchemy";
import { Config, Effect, Layer, Redacted } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";

import { AuthConfig } from "./auth/service.ts";
import { Db } from "./db/service.ts";
import { Imports } from "./import/service.ts";
import { Ingestion } from "./ingestion/service.ts";
import { handleOAuthEdgeRequest } from "./oauth/edge.ts";
import { RateLimiter } from "./rate-limit/service.ts";
import { RATE_LIMITS, type RateLimitBindingName } from "./rate-limits.ts";
import { ImportsStorage } from "./storage/service.ts";
import { IngestionLive } from "./worker.ts";

export const EffectDatabase = Cloudflare.D1.Database("EffectDatabase");
export const EffectImportsBucket = Cloudflare.R2.Bucket("EffectImportsBucket");
export const EffectOAuthKv = Cloudflare.KV.Namespace("EffectOAuthKv");

const BetterAuthSecret = Alchemy.makeRandom("BetterAuthSecret");

function rateLimitResource(name: RateLimitBindingName) {
  const { namespaceId, limit, period } = RATE_LIMITS[name];

  return Cloudflare.Workers.RateLimit(name, { namespaceId, simple: { limit, period } });
}

export const AuthRateLimit = rateLimitResource("AUTH_RATE_LIMIT");
export const PublicReadRateLimit = rateLimitResource("PUBLIC_READ_RATE_LIMIT");

/**
 * Effectful Alchemy Cloudflare Worker definition.
 *
 * The outer Effect binds Cloudflare resources (D1, R2, rate limits, secrets)
 * and registers the one-minute Cron trigger at deploy and cold-start time.
 * The inner `fetch` and `cron` Effects resolve request-scoped bindings from
 * `RuntimeContext` into typed Effect service Layers. Not yet wired into root
 * `alchemy.run.ts` until PR 7 cutover.
 */
export class EffectApiWorker extends Cloudflare.Workers.Worker<EffectApiWorker>()(
  "EffectApiWorker",
  {
    main: import.meta.url,
    compatibility: { date: "2026-11-02", flags: ["global_fetch_strictly_public"] },
    cache: { enabled: true },
    observability: { enabled: true, issues: { enabled: true } },
    env: {
      BETTER_AUTH_SECRET: BetterAuthSecret,
      SPOTIFY_CLIENT_ID: Config.String("SPOTIFY_CLIENT_ID"),
      SPOTIFY_CLIENT_SECRET: Config.Redacted("SPOTIFY_CLIENT_SECRET"),
    },
  },
  Effect.gen(function* () {
    const dbClient = yield* Cloudflare.D1.QueryDatabase(EffectDatabase);
    const importsBucket = yield* Cloudflare.R2.ReadWriteBucket(EffectImportsBucket);
    const oauthKv = yield* Cloudflare.KV.ReadWriteNamespace(EffectOAuthKv);
    // The module-scope values from `rateLimitResource` are already the
    // binding values: yield them directly. Re-calling the constructor with the
    // binding as its `name` arg crashes, since `props` is then undefined.
    const authLimiter = yield* AuthRateLimit;
    const publicReadLimiter = yield* PublicReadRateLimit;

    const makeInfraLayer = Effect.gen(function* () {
      const rawDb = yield* dbClient.raw;
      const rawBucket = yield* importsBucket.raw;
      const rawAuthLimiter = yield* authLimiter.raw;
      const rawPublicReadLimiter = yield* publicReadLimiter.raw;
      const betterAuthSecret = yield* Config.String("BETTER_AUTH_SECRET").pipe(Effect.orDie);
      const spotifyClientId = yield* Config.String("SPOTIFY_CLIENT_ID").pipe(Effect.orDie);

      const spotifyClientSecret = yield* Config.Redacted("SPOTIFY_CLIENT_SECRET").pipe(
        Effect.map(Redacted.value),
        Effect.orDie,
      );

      return Layer.mergeAll(
        Db.layerFromBinding(rawDb),
        ImportsStorage.layerFromBinding(rawBucket),
        RateLimiter.layerFromBindings({
          AUTH_RATE_LIMIT: rawAuthLimiter,
          PUBLIC_READ_RATE_LIMIT: rawPublicReadLimiter,
        }),
        AuthConfig.layer({
          betterAuthSecret,
          spotifyClientId,
          spotifyClientSecret,
        }),
      );
    });

    yield* Cloudflare.Workers.cron("* * * * *", (controller) =>
      Effect.gen(function* () {
        const infraLayer = yield* makeInfraLayer;

        const cronLayer = Layer.mergeAll(IngestionLive, Imports.layer).pipe(
          Layer.provide(infraLayer),
        );

        yield* Effect.gen(function* () {
          const ingestion = yield* Ingestion;
          const imports = yield* Imports;

          yield* ingestion.run(new Date(controller.scheduledTime));
          yield* imports.runTick();
        }).pipe(Effect.provide(cronLayer));
      }),
    );

    return {
      fetch: Effect.gen(function* () {
        const infraLayer = yield* makeInfraLayer;
        const rawKv = yield* oauthKv.raw;
        const workerCtx = yield* Cloudflare.Workers.WorkerExecutionContext;
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

        const webResponse = yield* Effect.promise(() =>
          handleOAuthEdgeRequest(webRequest, rawKv, workerCtx.raw, infraLayer),
        );

        return HttpServerResponse.fromWeb(webResponse);
      }),
    };
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        Cloudflare.D1.QueryDatabaseBinding,
        Cloudflare.R2.ReadWriteBucketBinding,
        Cloudflare.KV.ReadWriteNamespaceBinding,
        Cloudflare.Workers.RateLimitBinding,
        Cloudflare.Workers.CronEventSourceLive,
      ),
    ),
  ),
) {}
