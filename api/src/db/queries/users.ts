import { nanoid } from "nanoid";
import { db } from "..";
import { users, type UserInsert } from "../schema";

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

  await db.insert(users).values({ ...values, id, username: id, onboarded: true });
}
