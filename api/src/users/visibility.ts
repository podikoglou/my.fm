import { Effect } from "effect";

import type { PublicUser, UserProfile } from "../db/queries/users.ts";
import type { User } from "../db/schema.ts";

import { ProfilePrivateError, UserNotFoundError } from "./errors.ts";

export const FEED_VISIBLE_USER = { isPrivate: false, onboarded: true } as const;

export type MeUser = Pick<
  User,
  "id" | "username" | "name" | "email" | "avatarUrl" | "onboarded" | "isPrivate"
>;

export type McpMeUser = Pick<User, "id" | "username" | "name" | "onboarded" | "isPrivate">;

export function canViewProfile(profile: UserProfile, viewerId?: User["id"]): boolean {
  return !profile.isPrivate || profile.id === viewerId;
}

export function toPublicUser(profile: UserProfile): PublicUser {
  const { isPrivate: _, ...user } = profile;

  return user;
}

export function toMeUser(user: User): MeUser {
  const { id, username, name, email, avatarUrl, onboarded, isPrivate } = user;

  return { id, username, name, email, avatarUrl, onboarded, isPrivate };
}

export function toMcpMeUser(user: User): McpMeUser {
  const { id, username, name, onboarded, isPrivate } = user;

  return { id, username, name, onboarded, isPrivate };
}

export function resolveVisibleProfile(
  profile: UserProfile | undefined,
  viewerId?: User["id"],
): Effect.Effect<PublicUser, UserNotFoundError | ProfilePrivateError> {
  if (!profile) {
    return Effect.fail(new UserNotFoundError({ message: "User not found" }));
  }

  if (!canViewProfile(profile, viewerId)) {
    return Effect.fail(new ProfilePrivateError({ message: "Profile is private" }));
  }

  return Effect.succeed(toPublicUser(profile));
}
