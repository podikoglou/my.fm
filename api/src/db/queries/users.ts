import { db } from "..";
import { accounts, users, type User } from "../schema";
import { eq } from "drizzle-orm";

export async function findUserById(id: User["id"]) {
  return await db.query.users.findFirst({
    where: eq(users.id, id),
  });
}

export async function findUserByEmail(email: User["email"]) {
  return await db.query.users.findFirst({
    where: eq(users.email, email),
  });
}

export async function findUserByUsernamePublic(username: User["username"]) {
  return await db.query.users.findFirst({
    where: eq(users.username, username),
    columns: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  });
}

export async function findUserByIdPublic(id: User["id"]) {
  return await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: {
      id: true,
      username: true,
      name: true,
      avatarUrl: true,
    },
  });
}

export async function onboardUser(
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

export async function findUserQueueDataById(id: User["id"]) {
  return await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: {
      lastRecentTracksFetchTime: true,
    },
  });
}

export async function findUsersWithSpotify() {
  return await db.query.accounts.findMany({
    where: eq(accounts.providerId, "spotify"),
    columns: {
      userId: true,
    },
  });
}

export async function updateLastRecentTracksFetchTime(userId: User["id"], timestamp: Date) {
  await db.update(users).set({ lastRecentTracksFetchTime: timestamp }).where(eq(users.id, userId));
}
