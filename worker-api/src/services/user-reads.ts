import z from "zod";

import type { Database } from "../db/index.ts";
import type { User } from "../db/schema.ts";

import { findUserById } from "../db/queries/users.ts";

export const userByUsernameInput = z.object({ username: z.string() });
export const userByIdInput = z.object({ id: z.nanoid() });

export function toMeUser(user: User) {
  const { id, username, name, email, avatarUrl, onboarded, isPrivate } = user;

  return { id, username, name, email, avatarUrl, onboarded, isPrivate };
}

export async function getMeForMcp(db: Database, userId: string) {
  const user = await findUserById(db, userId);

  if (!user) return { error: "User not found", status: 404 } as const;
  const { id, username, name, onboarded, isPrivate } = user;

  return { data: { id, username, name, onboarded, isPrivate } };
}
