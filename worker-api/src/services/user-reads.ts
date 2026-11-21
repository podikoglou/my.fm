import z from "zod";

import type { Database } from "../db/index.ts";
import type { PublicUser, UserProfile } from "../db/queries/users.ts";
import type { User } from "../db/schema.ts";

import {
  canViewProfile,
  findUserById,
  findUserByIdPublic,
  findUserByUsernamePublic,
  toPublicUser,
} from "../db/queries/users.ts";

export const userByUsernameInput = z.object({ username: z.string() });
export const userByIdInput = z.object({ id: z.nanoid() });

function visibleUser(user: UserProfile | undefined, viewerUserId?: string) {
  if (!user) return { error: "User not found", status: 404 } as const;

  if (!canViewProfile(user, viewerUserId)) {
    return { error: "Profile is private", status: 403 } as const;
  }

  return { data: toPublicUser(user) };
}

export async function getUserByUsername(db: Database, username: string, viewerUserId?: string) {
  const input = userByUsernameInput.parse({ username });

  return visibleUser(await findUserByUsernamePublic(db, input.username), viewerUserId);
}

export async function getUserById(db: Database, id: string, viewerUserId?: string) {
  const input = userByIdInput.parse({ id });

  return visibleUser(await findUserByIdPublic(db, input.id), viewerUserId);
}

export function toMcpPublicUser(user: PublicUser) {
  const { avatarUrl: _, ...publicUser } = user;

  return publicUser;
}

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
