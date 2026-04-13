import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { exchangeCode, withAccessToken } from "../spotify";
import { createNewUser, findUserByEmail } from "../db/queries/users";
import { Temporal } from "@js-temporal/polyfill";
import { createJwt } from "../auth/jwt";
import type { User } from "../db/schema";
import { fetchQueue } from "../scheduler/queue";

export default new Hono().post(
  "/spotify",
  zValidator(
    "form",
    z.object({
      code: z.string(),
    }),
  ),
  async (c) => {
    const { code } = c.req.valid("form");

    // exchange authorization code for access token and create Spotify API client
    const accessToken = await exchangeCode(code);
    const spotify = withAccessToken(accessToken);

    // fetch user's profile data
    const profile = await spotify.currentUser.profile();

    // check if user already exists
    let user: User | undefined = await findUserByEmail(profile.email);

    if (!user) {
      // create new user in the database
      const expiration = Temporal.Now.instant().add(
        Temporal.Duration.from({ seconds: accessToken.expires_in }),
      );

      const result = await createNewUser({
        name: profile.display_name,
        email: profile.email,
        spotifyAccessToken: accessToken.access_token,
        spotifyRefreshToken: accessToken.refresh_token,
        spotifyTokenExpiration: expiration.epochMilliseconds.toString(),
        avatarUrl: profile.images[0]?.url,
      });

      user = result[0];
      if (!user) {
        console.error("Error creating user: ", { result });
        return c.json({ error: "Error creating user" }, 500);
      }

      // add to fetch queue
      // TODO: deduplicate this, this piece of codealready exists in the codebase
      fetchQueue.push({
        userId: user.id,
        accessToken: {
          access_token: user.spotifyAccessToken!,
          token_type: "Bearer",
          expires_in: Number(user.spotifyTokenExpiration),
          refresh_token: user.spotifyRefreshToken!,
        },
        lastRecentTracksFetchTime: null,
      });
    }

    // create JWT for user
    const jwt = await createJwt(user.id);

    return c.json({ accessToken: jwt }, 200);
  },
);
