import { Effect } from "effect";
import { HttpApiBuilder } from "effect/http-api";

import { CurrentUser, MyFmApi, OptionalSession, ServiceUnavailableError } from "../api/index.ts";
import { Users } from "../users/service.ts";

export const UserHandlers = HttpApiBuilder.group(
  MyFmApi,
  "user",
  Effect.fn(function* (handlers) {
    const users = yield* Users;

    return handlers
      .handle("me", () => CurrentUser)
      .handle("byUsername", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* users.viewProfileByUsername(query.username, session?.userId).pipe(
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
      .handle("byId", ({ query }) =>
        Effect.gen(function* () {
          const session = yield* OptionalSession;

          return yield* users.viewProfileById(query.id, session?.userId).pipe(
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
      .handle("updateSettings", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          return yield* users.updateSettings(user.id, payload).pipe(
            Effect.catchTags({
              D1QuotaExceededError: (error) =>
                Effect.fail(new ServiceUnavailableError({ error: error.message })),
              D1QueryError: (error) => Effect.die(error),
            }),
          );
        }),
      )
      .handle("onboard", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          return yield* users.onboard(user.id, payload).pipe(
            Effect.catchTags({
              UserNotFoundError: () => Effect.fail({ error: "User not found" as const }),
              AlreadyOnboardedError: () => Effect.fail({ error: "Already onboarded" as const }),
              D1QuotaExceededError: (error) =>
                Effect.fail(new ServiceUnavailableError({ error: error.message })),
              D1QueryError: (error) => Effect.die(error),
            }),
          );
        }),
      );
  }),
);
