import type {
  D1Database,
  ExecutionContext,
  KVNamespace,
  R2Bucket,
  ScheduledController,
} from "@cloudflare/workers-types";

import { Effect, Layer } from "effect";

import type { RateLimitBinding } from "./rate-limits.ts";

import { AuthConfig, AuthService } from "./auth/service.ts";
import { DbLive, type DatabaseRequirements } from "./db/service.ts";
import { type AppServices, handleWebRequest } from "./http/app.ts";
import { Imports } from "./import/service.ts";
import { Ingestion } from "./ingestion/service.ts";
import { handleOAuthEdgeRequest } from "./oauth/edge.ts";
import { OAuthProviderService } from "./oauth/service.ts";
import { RateLimiter } from "./rate-limit/service.ts";
import { Scrobbles } from "./scrobbles/service.ts";
import { SpotifyClient } from "./spotify/service.ts";
import { ImportsStorage } from "./storage/service.ts";
import { Users } from "./users/service.ts";

export type WorkerBindings = {
  readonly DB: D1Database;
  readonly IMPORTS_BUCKET: R2Bucket;
  readonly OAUTH_KV: KVNamespace;
  readonly AUTH_RATE_LIMIT: RateLimitBinding;
  readonly PUBLIC_READ_RATE_LIMIT: RateLimitBinding;
  readonly BETTER_AUTH_SECRET: string;
  readonly SPOTIFY_CLIENT_ID: string;
  readonly SPOTIFY_CLIENT_SECRET: string;
};

/**
 * Construct the per-request infrastructure Layer from Cloudflare Worker
 * bindings.
 *
 * D1 bindings are request-scoped in Workers and Miniflare, so every request
 * builds a fresh SQL client rather than caching a module-level client.
 */
export function makeWorkerInfraLayer(env: WorkerBindings): Layer.Layer<AppServices> {
  return Layer.mergeAll(
    DbLive(env.DB),
    ImportsStorage.layerFromBinding(env.IMPORTS_BUCKET),
    RateLimiter.layerFromBindings({
      AUTH_RATE_LIMIT: env.AUTH_RATE_LIMIT,
      PUBLIC_READ_RATE_LIMIT: env.PUBLIC_READ_RATE_LIMIT,
    }),
    AuthConfig.layer({
      betterAuthSecret: env.BETTER_AUTH_SECRET,
      spotifyClientId: env.SPOTIFY_CLIENT_ID,
      spotifyClientSecret: env.SPOTIFY_CLIENT_SECRET,
    }),
  );
}

/** Compose the `Ingestion` service layer on top of auth, scrobbles, and Spotify. */
export const IngestionLive: Layer.Layer<Ingestion, never, DatabaseRequirements | AuthConfig> =
  Ingestion.layer.pipe(
    Layer.provide(
      Layer.mergeAll(
        AuthService.layer,
        Scrobbles.layer.pipe(Layer.provide(Users.layer)),
        SpotifyClient.layer,
      ),
    ),
  );

/** Execute one scheduled ingestion + import tick with the given infrastructure Layer. */
export function runScheduledTick(
  scheduledTime: Date,
  infraLayer: Layer.Layer<AppServices>,
): Promise<void> {
  const cronLayer = Layer.mergeAll(IngestionLive, Imports.layer).pipe(Layer.provide(infraLayer));

  return Effect.runPromise(
    Effect.gen(function* () {
      const ingestion = yield* Ingestion;
      const imports = yield* Imports;

      yield* ingestion.run(scheduledTime);
      yield* imports.runTick();
    }).pipe(Effect.provide(cronLayer)),
  );
}

export default {
  fetch(request: Request, env: WorkerBindings, ctx?: ExecutionContext): Promise<Response> {
    const infraLayer = makeWorkerInfraLayer(env);

    if (!ctx) {
      return handleWebRequest(request, infraLayer, OAuthProviderService.unavailableLayer);
    }

    return handleOAuthEdgeRequest(request, env.OAUTH_KV, ctx, infraLayer);
  },

  scheduled(controller: ScheduledController, env: WorkerBindings, ctx: ExecutionContext): void {
    const scheduledTime = new Date(controller.scheduledTime);

    ctx.waitUntil(runScheduledTick(scheduledTime, makeWorkerInfraLayer(env)));
  },
};
