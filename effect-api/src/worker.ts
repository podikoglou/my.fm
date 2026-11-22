import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

import { Layer } from "effect";

import type { RateLimitBinding } from "./rate-limits.ts";

import { AuthConfig } from "./auth/service.ts";
import { Db } from "./db/service.ts";
import { type AppServices, handleWebRequest } from "./http/app.ts";
import { RateLimiter } from "./rate-limit/service.ts";
import { ImportsStorage } from "./storage/service.ts";

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
 * builds a fresh `Db` layer rather than caching a module-level client.
 */
export function makeWorkerInfraLayer(env: WorkerBindings): Layer.Layer<AppServices> {
  return Layer.mergeAll(
    Db.layerFromBinding(env.DB),
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

export default {
  fetch(request: Request, env: WorkerBindings): Promise<Response> {
    return handleWebRequest(request, makeWorkerInfraLayer(env));
  },
};
