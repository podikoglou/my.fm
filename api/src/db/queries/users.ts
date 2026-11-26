import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { DateFromEpochMillis, DateFromEpochSeconds } from "../columns.ts";
import { asDbError } from "../service.ts";
import { UserRow, type User, type UserRow as UserRowType } from "../schema.ts";

const UserProfileRow = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  isPrivate: Schema.BooleanFromBit,
});

const UserQueueDataRow = Schema.Struct({
  lastRecentTracksFetchTime: Schema.NullOr(DateFromEpochSeconds),
  lastFetchedAt: Schema.NullOr(DateFromEpochMillis),
  lastActiveAt: Schema.NullOr(DateFromEpochMillis),
});

const UserAccountRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
});

export type PublicUser = Pick<User, "id" | "username" | "name" | "avatarUrl">;

export type UserProfile = PublicUser & Pick<User, "isPrivate">;

const userFromRow = (row: UserRowType): User => {
  const { email_verified, updated_at, ...user } = row;

  return { ...user, emailVerified: email_verified, updatedAt: updated_at };
};

export const findUserById = Effect.fn("users.findById")(function* (id: User["id"]) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String }),
    Result: UserRow,
    execute: ({ id }) => sql`SELECT * FROM users WHERE id = ${id} LIMIT 1`,
  });

  const result = yield* asDbError(find({ id }));

  return Option.map(result, userFromRow).pipe(Option.getOrUndefined);
});

export const findUserByUsernamePublic = Effect.fn("users.findByUsernamePublic")(function* (
  username: User["username"],
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ username: Schema.String }),
    Result: UserProfileRow,
    execute: ({ username }) =>
      sql`SELECT id, username, name, avatarUrl, isPrivate FROM users WHERE username = ${username} AND onboarded = 1 LIMIT 1`,
  });

  const result = yield* asDbError(find({ username }));

  return Option.getOrUndefined(result);
});

export const findUserByIdPublic = Effect.fn("users.findByIdPublic")(function* (id: User["id"]) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String }),
    Result: UserProfileRow,
    execute: ({ id }) =>
      sql`SELECT id, username, name, avatarUrl, isPrivate FROM users WHERE id = ${id} AND onboarded = 1 LIMIT 1`,
  });

  const result = yield* asDbError(find({ id }));

  return Option.getOrUndefined(result);
});

export const onboardUser = Effect.fn("users.onboard")(function* (
  id: User["id"],
  values: {
    readonly username: User["username"];
    readonly name: User["name"];
  },
) {
  const sql = yield* SqlClient.SqlClient;
  yield* asDbError(sql`
    UPDATE users
    SET username = ${values.username}, name = ${values.name}, onboarded = 1, updated_at = ${Date.now()}
    WHERE id = ${id}
  `);
});

export const updateUserSettings = Effect.fn("users.updateSettings")(function* (
  id: User["id"],
  values: Pick<User, "isPrivate">,
) {
  const sql = yield* SqlClient.SqlClient;
  yield* asDbError(sql`
    UPDATE users SET isPrivate = ${values.isPrivate ? 1 : 0}, updated_at = ${Date.now()} WHERE id = ${id}
  `);
});

export const findSpotifyAccounts = Effect.fn("users.findSpotifyAccounts")(function* () {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findAll({
    Request: Schema.Void,
    Result: UserAccountRow,
    execute: () => sql`SELECT id, user_id AS userId FROM accounts WHERE provider_id = 'spotify'`,
  });

  return yield* asDbError(find(undefined));
});

export const findUserQueueDataById = Effect.fn("users.findQueueDataById")(function* (
  id: User["id"],
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findOneOption({
    Request: Schema.Struct({ id: Schema.String }),
    Result: UserQueueDataRow,
    execute: ({ id }) =>
      sql`SELECT lastRecentTracksFetchTime, lastFetchedAt, lastActiveAt FROM users WHERE id = ${id} LIMIT 1`,
  });

  const result = yield* asDbError(find({ id }));

  return Option.getOrUndefined(result);
});

export type UserFetchStateUpdate = {
  readonly lastFetchedAt: Date;
  readonly lastRecentTracksFetchTime?: Date;
  readonly lastActiveAt?: Date;
};

type UserFetchStateSqlUpdate = {
  lastFetchedAt: number;
  updated_at: number;
  lastRecentTracksFetchTime?: number;
  lastActiveAt?: number;
};

export const updateUserFetchState = Effect.fn("users.updateFetchState")(function* (
  userId: User["id"],
  values: UserFetchStateUpdate,
) {
  const sql = yield* SqlClient.SqlClient;

  const updates: UserFetchStateSqlUpdate = {
    lastFetchedAt: values.lastFetchedAt.getTime(),
    updated_at: Date.now(),
  };

  if (values.lastRecentTracksFetchTime !== undefined) {
    updates.lastRecentTracksFetchTime = Math.floor(
      values.lastRecentTracksFetchTime.getTime() / 1000,
    );
  }

  if (values.lastActiveAt !== undefined) {
    updates.lastActiveAt = values.lastActiveAt.getTime();
  }

  yield* asDbError(sql`UPDATE users SET ${sql.update(updates)} WHERE id = ${userId}`);
});

export const updateLastRecentTracksFetchTime = Effect.fn("users.updateLastRecentTracksFetchTime")(
  function* (userId: User["id"], timestamp: Date) {
    const sql = yield* SqlClient.SqlClient;
    yield* asDbError(sql`
    UPDATE users
    SET lastRecentTracksFetchTime = ${Math.floor(timestamp.getTime() / 1000)}, updated_at = ${Date.now()}
    WHERE id = ${userId}
  `);
  },
);
