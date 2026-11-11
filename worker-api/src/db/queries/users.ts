import { eq } from "drizzle-orm";

import type { Database } from "../index.ts";

import { users, type User } from "../schema.ts";

export async function findUserById(db: Database, id: User["id"]) {
  return await db.query.users.findFirst({
    where: { id },
  });
}

export async function findUserByUsernamePublic(db: Database, username: User["username"]) {
  return await db.query.users.findFirst({
    where: { username },
    columns: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  });
}

export async function findUserByIdPublic(db: Database, id: User["id"]) {
  return await db.query.users.findFirst({
    where: { id },
    columns: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
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

/**
 * Find every Spotify account with the local account ID and its owner.
 *
 * MIGRATION NOTE: Better Auth 1.7.20 selects tokens by `accountId`, so
 * ingestion needs the account row ID that the Bun API's `providerId` lookup
 * did not.
 */
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
