import { Effect, Layer } from "effect";
import { HttpRouter, HttpServerRequest, HttpServerResponse } from "effect/http";

import {
  CurrentUser,
  OptionalSession,
  OptionalSessionMiddleware,
  PublicReadRateLimitMiddleware,
  RequireSessionMiddleware,
} from "../api/index.ts";
import { AuthService } from "../auth/service.ts";
import { RateLimiter } from "../rate-limit/service.ts";
import { RATE_LIMITS } from "../rate-limits.ts";
import { Users } from "../users/service.ts";
import { rateLimitMiddleware } from "./middleware.ts";

function toWebHeaders(request: HttpServerRequest.HttpServerRequest): Headers {
  const headers = new Headers();

  for (const [key, value] of Object.entries(request.headers)) {
    if (value !== undefined) {
      headers.set(key, value);
    }
  }

  return headers;
}

export const OptionalSessionMiddlewareLive = Layer.effect(
  OptionalSessionMiddleware,
  Effect.gen(function* () {
    const auth = yield* AuthService;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        const session = yield* auth
          .getSession(toWebHeaders(request))
          .pipe(Effect.orElseSucceed(() => null));

        return yield* httpEffect.pipe(
          Effect.provideService(OptionalSession, session ? { userId: session.user.id } : null),
        );
      });
  }),
);

export const RequireSessionMiddlewareLive = Layer.effect(
  RequireSessionMiddleware,
  Effect.gen(function* () {
    const auth = yield* AuthService;
    const users = yield* Users;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;

        const session = yield* auth
          .getSession(toWebHeaders(request))
          .pipe(Effect.orElseSucceed(() => null));

        if (!session) {
          return yield* Effect.fail({ error: "" as const });
        }

        const user = yield* users.getMe(session.user.id).pipe(
          Effect.catchTags({
            UserNotFoundError: () => Effect.fail({ error: "" as const }),
            D1QuotaExceededError: (error) => Effect.die(error),
            D1QueryError: (error) => Effect.die(error),
          }),
        );

        return yield* httpEffect.pipe(Effect.provideService(CurrentUser, user));
      });
  }),
);

export const PublicReadRateLimitMiddlewareLive = Layer.effect(
  PublicReadRateLimitMiddleware,
  Effect.gen(function* () {
    const rateLimiter = yield* RateLimiter;
    const { period } = RATE_LIMITS.PUBLIC_READ_RATE_LIMIT;

    return (httpEffect) =>
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const ip = request.headers["cf-connecting-ip"] ?? "unknown";

        const allowed = yield* rateLimiter.check("PUBLIC_READ_RATE_LIMIT", ip).pipe(
          Effect.as(true),
          Effect.catchTag("RateLimitExceededError", () => Effect.succeed(false)),
          Effect.orDie,
        );

        if (!allowed) {
          return HttpServerResponse.jsonUnsafe(
            { error: "Too many requests" },
            {
              status: 429,
              headers: { "retry-after": String(period) },
            },
          );
        }

        return yield* httpEffect;
      });
  }),
);

/**
 * Mount Better Auth's Web handler at `/api/auth/*` behind the
 * `AUTH_RATE_LIMIT` middleware.
 */
export const BetterAuthRoutes = Layer.unwrap(
  Effect.gen(function* () {
    const auth = yield* AuthService;

    return HttpRouter.add(
      "*",
      "/api/auth/*",
      Effect.gen(function* () {
        const request = yield* HttpServerRequest.HttpServerRequest;
        const webRequest = yield* HttpServerRequest.toWeb(request);
        const response = yield* auth.handler(webRequest);

        return HttpServerResponse.fromWeb(response);
      }).pipe(Effect.orDie),
    );
  }),
).pipe(Layer.provide(rateLimitMiddleware("AUTH_RATE_LIMIT")));
