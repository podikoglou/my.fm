import { nanoid } from "nanoid";
import { db } from "..";
import { users, type User, type UserInsert } from "../schema";
import { eq } from "drizzle-orm";

/**
 * This creates a new user. New users are typically created and are immediately put in the onboarding state
 * (onboarded = 1).
 *
 * Since we only support Spotify authentication right now, we also assume that the user
 * is being created through the Spotify auth flow, and that we have the access token, and that we have the
 * access token from Spotify.
 */
export async function createNewUser(
  values: Pick<
    UserInsert,
    "name" | "email" | "spotifyAccessToken" | "spotifyRefreshToken" | "spotifyTokenExpiration"
  >,
) {
  const id = nanoid();

  return await db
    .insert(users)
    .values({ ...values, id, username: id, onboarded: true })
    .returning();
}

export async function findUserById(id: User["id"]) {
  return await db.query.users.findFirst({
    where: eq(users.id, id),
    columns: {
      id: true,
      username: true,
      name: true,
      email: true,
      onboarded: true,
    },
  });
}

export async function findUserByUsername(username: User["username"]) {
  return await db.query.users.findFirst({
    where: eq(users.username, username),
    columns: {
      id: true,
      username: true,
      name: true,
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
    },
  });
}
