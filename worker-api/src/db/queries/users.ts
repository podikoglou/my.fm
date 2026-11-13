import { eq } from "drizzle-orm";

import type { Database } from "../index.ts";

import { users, type User } from "../schema.ts";

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

export function canViewProfile(profile: UserProfile, viewerId?: User["id"]) {
  return !profile.isPrivate || profile.id === viewerId;
}

export function toPublicUser(profile: UserProfile): PublicUser {
  const { isPrivate: _, ...user } = profile;

  return user;
}

export async function findUserById(db: Database, id: User["id"]) {
  return await db.query.users.findFirst({
    where: { id },
  });
}

export async function findUserByUsernamePublic(
  db: Database,
  username: User["username"],
): Promise<UserProfile | undefined> {
  return await db.query.users.findFirst({
    // A profile is public only after onboarding, which gives it a username that
    // someone can share.
    where: { username, onboarded: true },
    columns: profileColumns,
  });
}

export async function findUserByIdPublic(
  db: Database,
  id: User["id"],
): Promise<UserProfile | undefined> {
  return await db.query.users.findFirst({
    where: { id, onboarded: true },
    columns: profileColumns,
  });
}

export async function onboardUser(
  db: Database,
  id: User["id"],
  values: {
    username: User["username"];
    name: User["name"];
  },
) {
  return await db
    .update(users)
    .set({ ...values, onboarded: true })
    .where(eq(users.id, id));
}

export async function updateUserSettings(
  db: Database,
  id: User["id"],
  values: Pick<User, "isPrivate">,
) {
  return await db.update(users).set(values).where(eq(users.id, id));
}

export async function findSpotifyAccounts(db: Database) {
  return await db.query.accounts.findMany({
    where: { providerId: "spotify" },
    columns: {
      id: true,
      userId: true,
    },
  });
}

export async function findUserQueueDataById(db: Database, id: User["id"]) {
  return await db.query.users.findFirst({
    where: { id },
    columns: {
      lastRecentTracksFetchTime: true,
    },
  });
}

export async function updateLastRecentTracksFetchTime(
  db: Database,
  userId: User["id"],
  timestamp: Date,
) {
  await db.update(users).set({ lastRecentTracksFetchTime: timestamp }).where(eq(users.id, userId));
}
