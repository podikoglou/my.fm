import { eq } from "drizzle-orm";

import type { DrizzleDatabase } from "../service.ts";
import { type User, users } from "../schema.ts";

const publicUserColumns = {
  id: true,
  username: true,
  name: true,
  avatarUrl: true,
} as const;

const profileColumns = {
  ...publicUserColumns,
  isPrivate: true,
} as const;

export type PublicUser = Pick<User, "id" | "username" | "name" | "avatarUrl">;

export type UserProfile = PublicUser & Pick<User, "isPrivate">;

export function findUserById(db: DrizzleDatabase, id: User["id"]) {
  return db.query.users.findFirst({
    where: { id },
  });
}

export function findUserByUsernamePublic(
  db: DrizzleDatabase,
  username: User["username"],
): Promise<UserProfile | undefined> {
  return db.query.users.findFirst({
    where: { username, onboarded: true },
    columns: profileColumns,
  });
}

export function findUserByIdPublic(
  db: DrizzleDatabase,
  id: User["id"],
): Promise<UserProfile | undefined> {
  return db.query.users.findFirst({
    where: { id, onboarded: true },
    columns: profileColumns,
  });
}

export function onboardUser(
  db: DrizzleDatabase,
  id: User["id"],
  values: {
    readonly username: User["username"];
    readonly name: User["name"];
  },
) {
  return db
    .update(users)
    .set({ ...values, onboarded: true })
    .where(eq(users.id, id));
}

export function updateUserSettings(
  db: DrizzleDatabase,
  id: User["id"],
  values: Pick<User, "isPrivate">,
) {
  return db.update(users).set(values).where(eq(users.id, id));
}

export function findSpotifyAccounts(db: DrizzleDatabase) {
  return db.query.accounts.findMany({
    where: { providerId: "spotify" },
    columns: {
      id: true,
      userId: true,
    },
  });
}

export function findUserQueueDataById(db: DrizzleDatabase, id: User["id"]) {
  return db.query.users.findFirst({
    where: { id },
    columns: {
      lastRecentTracksFetchTime: true,
      lastFetchedAt: true,
      lastActiveAt: true,
    },
  });
}

export type UserFetchStateUpdate = {
  readonly lastFetchedAt: Date;
  readonly lastRecentTracksFetchTime?: Date;
  readonly lastActiveAt?: Date;
};

export async function updateUserFetchState(
  db: DrizzleDatabase,
  userId: User["id"],
  values: UserFetchStateUpdate,
) {
  await db.update(users).set(values).where(eq(users.id, userId));
}

export async function updateLastRecentTracksFetchTime(
  db: DrizzleDatabase,
  userId: User["id"],
  timestamp: Date,
) {
  await db.update(users).set({ lastRecentTracksFetchTime: timestamp }).where(eq(users.id, userId));
}
