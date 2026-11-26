import { Context, Effect, Layer } from "effect";

import type { User } from "../db/schema.ts";
import type { DbError } from "../db/errors.ts";
import type { PublicUser } from "../db/queries/users.ts";
import type { McpMeUser, MeUser } from "./visibility.ts";

import {
  findUserById,
  findUserByIdPublic,
  findUserByUsernamePublic,
  onboardUser,
  updateUserSettings,
} from "../db/queries/users.ts";
import { SqlClient } from "effect/sql";
import type { SqlClient as SqlClientService } from "effect/sql/SqlClient";
import type { ProfilePrivateError } from "./errors.ts";
import { AlreadyOnboardedError, UserNotFoundError } from "./errors.ts";
import { resolveVisibleProfile, toMcpMeUser, toMeUser } from "./visibility.ts";

export interface UsersService {
  readonly findById: (id: User["id"]) => Effect.Effect<User | undefined, DbError>;
  readonly getMe: (userId: User["id"]) => Effect.Effect<MeUser, UserNotFoundError | DbError>;
  readonly getMeForMcp: (
    userId: User["id"],
  ) => Effect.Effect<McpMeUser, UserNotFoundError | DbError>;
  readonly viewProfileByUsername: (
    username: string,
    viewerId?: User["id"],
  ) => Effect.Effect<PublicUser, UserNotFoundError | ProfilePrivateError | DbError>;
  readonly viewProfileById: (
    id: User["id"],
    viewerId?: User["id"],
  ) => Effect.Effect<PublicUser, UserNotFoundError | ProfilePrivateError | DbError>;
  readonly updateSettings: (
    userId: User["id"],
    values: { readonly isPrivate: boolean },
  ) => Effect.Effect<{ readonly isPrivate: boolean }, DbError>;
  readonly onboard: (
    userId: User["id"],
    values: { readonly username: string; readonly name: string },
  ) => Effect.Effect<{ readonly ok: true }, UserNotFoundError | AlreadyOnboardedError | DbError>;
}

export class Users extends Context.Service<Users, UsersService>()("@my.fm/api/users/Users") {
  static readonly layer: Layer.Layer<Users, never, SqlClientService> = Layer.effect(
    Users,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      const runDb = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
        effect.pipe(Effect.provideService(SqlClient.SqlClient, sql));

      const findById = Effect.fn("Users.findById")(function* (id: User["id"]) {
        return yield* runDb(findUserById(id));
      });

      const getMe = Effect.fn("Users.getMe")(function* (userId: User["id"]) {
        const user = yield* findById(userId);

        if (!user) {
          return yield* new UserNotFoundError({ message: "User not found" });
        }

        return toMeUser(user);
      });

      const getMeForMcp = Effect.fn("Users.getMeForMcp")(function* (userId: User["id"]) {
        const user = yield* findById(userId);

        if (!user) {
          return yield* new UserNotFoundError({ message: "User not found" });
        }

        return toMcpMeUser(user);
      });

      const viewProfileByUsername = Effect.fn("Users.viewProfileByUsername")(function* (
        username: string,
        viewerId?: User["id"],
      ) {
        const profile = yield* runDb(findUserByUsernamePublic(username));

        return yield* resolveVisibleProfile(profile, viewerId);
      });

      const viewProfileById = Effect.fn("Users.viewProfileById")(function* (
        id: User["id"],
        viewerId?: User["id"],
      ) {
        const profile = yield* runDb(findUserByIdPublic(id));

        return yield* resolveVisibleProfile(profile, viewerId);
      });

      const updateSettings = Effect.fn("Users.updateSettings")(function* (
        userId: User["id"],
        values: { readonly isPrivate: boolean },
      ) {
        yield* runDb(updateUserSettings(userId, values));

        return { isPrivate: values.isPrivate };
      });

      const onboard = Effect.fn("Users.onboard")(function* (
        userId: User["id"],
        values: { readonly username: string; readonly name: string },
      ) {
        const user = yield* findById(userId);

        if (!user) {
          return yield* new UserNotFoundError({ message: "User not found" });
        }

        if (user.onboarded) {
          return yield* new AlreadyOnboardedError({ message: "Already onboarded" });
        }

        yield* runDb(onboardUser(userId, values));

        return { ok: true as const };
      });

      return Users.of({
        findById,
        getMe,
        getMeForMcp,
        viewProfileByUsername,
        viewProfileById,
        updateSettings,
        onboard,
      });
    }),
  );
}
