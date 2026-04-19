import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { exchangeCode, userDataToAccessToken, withAccessToken } from "../spotify";
import { createNewUser, findUserByEmail, updateUserAccessToken } from "../db/queries/users";
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

    if (user) {
      // if user exists, simply update the spotify token in the db
      await updateUserAccessToken(user.id, userDataToAccessToken.encode(accessToken));
    } else {
      // if user doens't exist, create it
      const result = await createNewUser({
        name: profile.display_name,
        email: profile.email,
        avatarUrl: profile.images[0]?.url,
        ...userDataToAccessToken.encode(accessToken),
      });

      user = result[0];
      if (!user) {
        console.error("Error creating user: ", { result });
        return c.json({ error: "Error creating user" }, 500);
      }

      // add to fetch queue
      fetchQueue.push(user.id);
    }

    // create JWT for user
    const jwt = await createJwt(user.id);

    return c.json({ accessToken: jwt }, 200);
  },
);
