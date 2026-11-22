import { Context, Effect, Layer, Schema } from "effect";

import { RATE_LIMITS, type RateLimitBinding, type RateLimitBindingName } from "../rate-limits.ts";

export const UNKNOWN_RATE_LIMIT_KEY = "unknown";

export class RateLimitExceededError extends Schema.TaggedError<
  RateLimitExceededError,
  { readonly brand: unique symbol }
>()(
  "RateLimitExceededError",
  {
    policy: Schema.Literals(["AUTH_RATE_LIMIT", "PUBLIC_READ_RATE_LIMIT"]),
    retryAfterSeconds: Schema.Finite,
  },
  { httpApiStatus: 429 },
) {}

export class RateLimitCheckError extends Schema.TaggedError<
  RateLimitCheckError,
  { readonly brand: unique symbol }
>()("RateLimitCheckError", {
  policy: Schema.Literals(["AUTH_RATE_LIMIT", "PUBLIC_READ_RATE_LIMIT"]),
  message: Schema.String,
}) {}

export type RateLimitError = RateLimitExceededError | RateLimitCheckError;

export type RateLimitBindings = Record<RateLimitBindingName, RateLimitBinding>;

function makeRateLimiterService(bindings: RateLimitBindings): RateLimiter["Service"] {
  const check = Effect.fn("RateLimiter.check")(function* (
    policy: RateLimitBindingName,
    key: string,
  ): Effect.fn.Return<void, RateLimitError> {
    const binding = bindings[policy];
    const { period } = RATE_LIMITS[policy];

    const outcome = yield* Effect.tryPromise({
      try: () => binding.limit({ key }),
      catch: (cause) =>
        new RateLimitCheckError({
          policy,
          message: cause instanceof Error ? cause.message : String(cause),
        }),
    });

    if (!outcome.success) {
      return yield* new RateLimitExceededError({
        policy,
        retryAfterSeconds: period,
      });
    }
  });

  return RateLimiter.of({ check });
}

export class RateLimiter extends Context.Service<
  RateLimiter,
  {
    readonly check: (
      policy: RateLimitBindingName,
      key: string,
    ) => Effect.Effect<void, RateLimitError>;
  }
>()("@my.fm/api/rate-limit/RateLimiter") {
  static readonly layerFromBindings = (bindings: RateLimitBindings): Layer.Layer<RateLimiter> =>
    Layer.sync(RateLimiter, () => makeRateLimiterService(bindings));
}
