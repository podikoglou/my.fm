import { Effect } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import { RateLimiter, UNKNOWN_RATE_LIMIT_KEY } from "../rate-limit/service.ts";
import type { RateLimitBindingName } from "../rate-limits.ts";

/**
 * Workers Cache checks before the Worker runs, so a response without a policy
 * can be stored by heuristic freshness. Every response therefore starts
 * private; only a public route opts in by setting its own `Cache-Control`.
 */
export const DefaultCacheControlMiddleware = HttpRouter.middleware(
  (httpEffect) =>
    Effect.map(httpEffect, (response) =>
      response.headers["cache-control"] === undefined
        ? HttpServerResponse.setHeader(response, "cache-control", "private, no-store")
        : response,
    ),
  { global: true },
);

/**
 * Enforce a Cloudflare Rate Limiting policy against `cf-connecting-ip`
 * (falling back to `"unknown"` when absent).
 */
export const enforceRateLimit = Effect.fn("http.enforceRateLimit")(function* (
  policy: RateLimitBindingName,
) {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const limiter = yield* RateLimiter;
  const key = request.headers["cf-connecting-ip"] ?? UNKNOWN_RATE_LIMIT_KEY;

  yield* limiter.check(policy, key);
});

/**
 * Route-scoped rate-limit middleware returning 429 with `Retry-After` and
 * `Cache-Control: private, no-store` when a client exceeds its budget.
 */
export function rateLimitMiddleware(policy: RateLimitBindingName) {
  return HttpRouter.middleware(
    Effect.gen(function* () {
      const limiter = yield* RateLimiter;

      return (httpEffect) =>
        enforceRateLimit(policy).pipe(
          Effect.provideService(RateLimiter, limiter),
          Effect.andThen(httpEffect),
          Effect.catchTags({
            RateLimitExceededError: (error) =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { error: "Too many requests" },
                  {
                    status: 429,
                    headers: {
                      "retry-after": String(error.retryAfterSeconds),
                      "cache-control": "private, no-store",
                    },
                  },
                ),
              ),
            RateLimitCheckError: () =>
              Effect.succeed(
                HttpServerResponse.jsonUnsafe(
                  { error: "Something went wrong. Please try again." },
                  {
                    status: 500,
                    headers: {
                      "cache-control": "private, no-store",
                    },
                  },
                ),
              ),
          }),
        );
    }),
  ).layer;
}
