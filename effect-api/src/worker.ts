import type { D1Database, KVNamespace, R2Bucket } from "@cloudflare/workers-types";

import { Layer } from "effect";

import type { RateLimitBinding } from "./rate-limits.ts";

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
  );
}

export default {
  fetch(request: Request, env: WorkerBindings): Promise<Response> {
    return handleWebRequest(request, makeWorkerInfraLayer(env));
  },
};
