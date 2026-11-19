import type { MiddlewareHandler } from "hono";

import type { RateLimitBindingName, RateLimiter } from "./rate-limits.ts";
import type { AppEnv } from "./types.ts";

import { RATE_LIMITS } from "./rate-limits.ts";

/**
 * Cloudflare sets `CF-Connecting-IP` at the edge and overwrites a value from
 * the caller. A request without it, which local development sends, shares one
 * budget with every other such request: a missing header cannot buy a fresh
 * one.
 */
const UNKNOWN_CLIENT = "unknown";

/**
 * Call this before `sessionMiddleware`: a rejected request then costs no
 * session query.
 *
 * The binding reports whether a key is over budget and not how much of the
 * window is left, so `Retry-After` states the whole window.
 */
export function rateLimit(binding: RateLimitBindingName): MiddlewareHandler<AppEnv> {
  const { period } = RATE_LIMITS[binding];

  return async (c, next) => {
    const limiter: RateLimiter = c.env[binding];
    const key = c.req.header("cf-connecting-ip") ?? UNKNOWN_CLIENT;
    const { success } = await limiter.limit({ key });

    if (!success) {
      return c.json({ error: "Too many requests" }, 429, { "Retry-After": String(period) });
    }

    await next();
  };
}
