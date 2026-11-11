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
