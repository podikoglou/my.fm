import type { Database } from "./db/index.ts";
import type { PublicUser, UserProfile } from "./db/queries/users.ts";
import type { User } from "./db/schema.ts";

import { findUserByIdPublic, findUserByUsernamePublic } from "./db/queries/users.ts";

/**
 * What one viewer may see of one user's profile. A profile is public only
 * after onboarding, and only the owner sees a private profile.
 */
export type ProfileView =
  | { error: "User not found"; status: 404 }
  | { error: "Profile is private"; status: 403 }
  | { data: PublicUser };

/**
 * The users whose plays the shared feed may show: public and onboarded.
 * The feed query filters its user relation with this, so the feed carries
 * only the plays that `viewProfileByUsername` would let a stranger see.
 */
export const FEED_VISIBLE_USER = { isPrivate: false, onboarded: true } as const;

function canViewProfile(profile: UserProfile, viewerId?: User["id"]) {
  return !profile.isPrivate || profile.id === viewerId;
}

function toPublicUser(profile: UserProfile): PublicUser {
  const { isPrivate: _, ...user } = profile;

  return user;
}

function visibleProfile(profile: UserProfile | undefined, viewerId?: User["id"]): ProfileView {
  if (!profile) return { error: "User not found", status: 404 };

  if (!canViewProfile(profile, viewerId)) {
    return { error: "Profile is private", status: 403 };
  }

  return { data: toPublicUser(profile) };
}

/** What `viewerId` may see of the onboarded user named `username`. */
export async function viewProfileByUsername(
  db: Database,
  username: string,
  viewerId?: User["id"],
): Promise<ProfileView> {
  return visibleProfile(await findUserByUsernamePublic(db, username), viewerId);
}

/** What `viewerId` may see of the onboarded user with `id`. */
export async function viewProfileById(
  db: Database,
  id: User["id"],
  viewerId?: User["id"],
): Promise<ProfileView> {
  return visibleProfile(await findUserByIdPublic(db, id), viewerId);
}
