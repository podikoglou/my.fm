import { nanoid } from "nanoid";
import { db } from "..";
import { users, type User, type UserInsert } from "../schema";
import { eq, isNotNull, and } from "drizzle-orm";

/**
 * This creates a new user. New users are typically created and are immediately put in the onboarding state
 * (onboarded = 0).
 *
 * Since we only support Spotify authentication right now, we also assume that the user
 * is being created through the Spotify auth flow, and that we have the access token, and that we have the
 * access token from Spotify.
 */
export async function createNewUser(
  values: Pick<
    UserInsert,
    | "name"
    | "email"
    | "spotifyAccessToken"
    | "spotifyRefreshToken"
    | "spotifyTokenExpiration"
    | "avatarUrl"
  >,
) {
  const id = nanoid();

  return await db
    .insert(users)
    .values({ ...values, id, username: id, onboarded: false })
    .returning();
}

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

/**
 * Returns a list of User IDs and their spotify access tokens. This is used for seeding the fetch queue
 */
export async function findUsersWithSpotify() {
  return await db.query.users.findMany({
    // the return type for this still has the below fields as nullable,
    // would be nice if we could somehow make them non nullable on the
    // type level since they're not nullable in practice because of this
    where: and(
      isNotNull(users.spotifyAccessToken),
      isNotNull(users.spotifyRefreshToken),
      isNotNull(users.spotifyTokenExpiration),
    ),
    columns: {
      id: true,
      spotifyAccessToken: true,
      spotifyRefreshToken: true,
      spotifyTokenExpiration: true,
    },
  });
}
