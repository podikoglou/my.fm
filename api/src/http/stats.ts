import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { MyFmApi, OptionalSession, ServiceUnavailableError } from "../api/index.ts";
import { DEFAULT_SAMPLE_SIZE, DEFAULT_TOP_LIMIT, TIMELINE_TOO_LONG } from "../api/stats.ts";
import { Stats } from "../stats/service.ts";

export const StatsHandlers = HttpApiBuilder.group(
  MyFmApi,
  "stats",
  Effect.fn(function* (handlers) {
    const stats = yield* Stats;

    return handlers
      .handle("getSummary", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* stats.getSummary(query, session?.userId).pipe(
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
      .handle("getTop", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* stats
            .getTop({ ...query, limit: query.limit ?? DEFAULT_TOP_LIMIT }, session?.userId)
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
      .handle("getTimeline", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* stats
            .getTimeline({ ...query, timeZone: query.timeZone ?? "UTC" }, session?.userId)
            .pipe(
              Effect.catchTags({
                UserNotFoundError: () => Effect.fail({ error: "User not found" as const }),
                ProfilePrivateError: () => Effect.fail({ error: "Profile is private" as const }),
                D1QuotaExceededError: (error) =>
                  Effect.fail(new ServiceUnavailableError({ error: error.message })),
                D1QueryError: (error) => Effect.die(error),
                TimelineTooLongError: () => Effect.fail({ error: TIMELINE_TOO_LONG } as const),
              }),
            );
        }),
      )
      .handle("getSample", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* stats
            .getSample(
              {
                ...query,
                size: query.size ?? DEFAULT_SAMPLE_SIZE,
                seed: query.seed ?? 0,
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
