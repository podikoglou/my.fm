import { Effect, Layer } from "effect";
import { HttpRouter, HttpServer } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import type { AuthConfig } from "../auth/service.ts";
import type { Db } from "../db/service.ts";
import type { RateLimiter } from "../rate-limit/service.ts";
import type { ImportsStorage } from "../storage/service.ts";

import { MyFmApi } from "../api/index.ts";
import { AuthService } from "../auth/service.ts";
import { Imports } from "../import/service.ts";
import { Notifications } from "../notifications/service.ts";
import { OAuthProviderService } from "../oauth/service.ts";
import { Scrobbles } from "../scrobbles/service.ts";
import { Stats } from "../stats/service.ts";
import { Users } from "../users/service.ts";
import {
  AuthRateLimitMiddlewareLive,
  BetterAuthRoutes,
  OptionalSessionMiddlewareLive,
  PublicReadRateLimitMiddlewareLive,
  RequireSessionMiddlewareLive,
} from "./auth.ts";
import { FeedCacheMiddlewareLive, FeedHandlers } from "./feed.ts";
import { HealthHandlers } from "./health.ts";
import { ImportHandlers } from "./import.ts";
import { DefaultCacheControlMiddleware } from "./middleware.ts";
import { NotificationsHandlers } from "./notifications.ts";
import { OAuthHandlers } from "./oauth.ts";
import { ScrobbleHandlers } from "./scrobble.ts";
import { StatsHandlers } from "./stats.ts";
import { UserHandlers } from "./user.ts";

export type AppServices = Db | ImportsStorage | RateLimiter | AuthConfig;

export type HttpAppServices = AppServices | OAuthProviderService;

const BaseDomainLayer = Layer.mergeAll(
  AuthService.layer,
  Users.layer,
  Notifications.layer,
  Imports.layer,
);

const DomainLayer = Layer.mergeAll(
  BaseDomainLayer,
  Scrobbles.layer.pipe(Layer.provide(BaseDomainLayer)),
  Stats.layer.pipe(Layer.provide(BaseDomainLayer)),
);

const MiddlewareLayer = Layer.mergeAll(
  OptionalSessionMiddlewareLive,
  RequireSessionMiddlewareLive,
  PublicReadRateLimitMiddlewareLive,
  AuthRateLimitMiddlewareLive,
  FeedCacheMiddlewareLive,
);

const ApiRoutes = HttpApiBuilder.layer(MyFmApi).pipe(
  Layer.provide(
    Layer.mergeAll(
      HealthHandlers,
      UserHandlers,
      ScrobbleHandlers,
      StatsHandlers,
      FeedHandlers,
      NotificationsHandlers,
      ImportHandlers,
      OAuthHandlers,
    ),
  ),
  Layer.provide(MiddlewareLayer),
);

/**
 * Full HTTP router layer for my.fm, requiring only typed infrastructure
 * services (`Db`, `ImportsStorage`, `RateLimiter`, `AuthConfig`) and
 * `OAuthProviderService`.
 */
export const HttpAppLayer = Layer.mergeAll(
  ApiRoutes,
  BetterAuthRoutes,
  DefaultCacheControlMiddleware,
).pipe(Layer.provide(DomainLayer), Layer.provide(HttpServer.layerServices));

/**
 * Build a Web `fetch`-compatible handler backed by the supplied infrastructure
 * service layer.
 */
export function makeWebHandler(
  infraLayer: Layer.Layer<AppServices>,
  oauthLayer: Layer.Layer<OAuthProviderService> = OAuthProviderService.unavailableLayer,
) {
  return HttpRouter.toWebHandler(
    HttpAppLayer.pipe(Layer.provide(Layer.mergeAll(infraLayer, oauthLayer))),
    {
      disableLogger: true,
    },
  );
}

/**
 * Handle a single Web `Request` against a per-request infrastructure layer and
 * dispose the handler runtime afterward.
 *
 * Ensures unmatched routes and unhandled failures always carry
 * `Cache-Control: private, no-store`.
 */
export async function handleWebRequest(
  request: Request,
  infraLayer: Layer.Layer<AppServices>,
  oauthLayer: Layer.Layer<OAuthProviderService> = OAuthProviderService.unavailableLayer,
): Promise<Response> {
  const { handler, dispose } = makeWebHandler(infraLayer, oauthLayer);

  try {
    const response = await handler(request);

    if (response.headers.has("cache-control")) {
      return response;
    }

    const headers = new Headers(response.headers);

    headers.set("cache-control", "private, no-store");

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers,
    });
  } finally {
    await dispose();
  }
}

/**
 * Convenience helper for running an Effect against an infrastructure layer in
 * tests or non-HTTP entrypoints.
 */
export function runWithInfra<A, E>(
  effect: Effect.Effect<A, E, AppServices>,
  infraLayer: Layer.Layer<AppServices>,
): Promise<A> {
  return Effect.runPromise(effect.pipe(Effect.provide(infraLayer)));
}
