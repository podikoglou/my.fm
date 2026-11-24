import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { MyFmApi, OptionalSession, ServiceUnavailableError } from "../api/index.ts";
import { Scrobbles } from "../scrobbles/service.ts";

export const ScrobbleHandlers = HttpApiBuilder.group(
  MyFmApi,
  "scrobble",
  Effect.fn(function* (handlers) {
    const scrobbles = yield* Scrobbles;

    return handlers
      .handle("getRecent", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* scrobbles
            .getRecent(
              {
                username: query.username,
                offset: query.offset,
                limit: query.limit ?? 8,
                before: query.before,
              },
              session?.userId,
            )
            .pipe(
              Effect.catchTags({
                UserNotFoundError: () => Effect.fail({ error: "User not found" as const }),
                ProfilePrivateError: () => Effect.fail({ error: "Profile is private" as const }),
                D1QuotaExceededError: (error) =>
                  Effect.fail(new ServiceUnavailableError({ error: error.message })),
                D1QueryError: (error) => Effect.die(error),
              }),
            );
        }),
      )
      .handle("getMonths", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* scrobbles
            .getMonths(
              {
                username: query.username,
                timeZone: query.timeZone ?? "UTC",
              },
              session?.userId,
            )
            .pipe(
              Effect.catchTags({
                UserNotFoundError: () => Effect.fail({ error: "User not found" as const }),
                ProfilePrivateError: () => Effect.fail({ error: "Profile is private" as const }),
                D1QuotaExceededError: (error) =>
                  Effect.fail(new ServiceUnavailableError({ error: error.message })),
                D1QueryError: (error) => Effect.die(error),
              }),
            );
        }),
      );
  }),
);
