import { Effect, Layer } from "effect";
import { HttpServerRequest, HttpServerResponse } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import { FeedCacheMiddleware, MyFmApi, ServiceUnavailableError } from "../api/index.ts";
import { Scrobbles } from "../scrobbles/service.ts";

export const FeedCacheMiddlewareLive = Layer.succeed(FeedCacheMiddleware, (httpEffect) =>
  Effect.gen(function* () {
    const request = yield* HttpServerRequest.HttpServerRequest;
    const response = yield* httpEffect;

    if (response.status !== 200) {
      return response;
    }

    const url = new URL(request.url, "http://localhost");
    const hasCursor = url.searchParams.has("cursor");
    const policy = hasCursor ? "public, max-age=300" : "public, max-age=30";

    return HttpServerResponse.setHeader(response, "cache-control", policy);
  }),
);

export const FeedHandlers = HttpApiBuilder.group(
  MyFmApi,
  "feed",
  Effect.fn(function* (handlers) {
    const scrobbles = yield* Scrobbles;

    return handlers.handle("getFeed", ({ query }) =>
      scrobbles
        .getPublicFeed({
          cursor: query.cursor,
          limit: query.limit ?? 20,
        })
        .pipe(
          Effect.catchTags({
            InvalidCursorError: () => Effect.fail({ error: "Invalid cursor" as const }),
            D1QuotaExceededError: (error) =>
              Effect.fail(new ServiceUnavailableError({ error: error.message })),
            D1QueryError: (error) => Effect.die(error),
          }),
        ),
    );
  }),
);
