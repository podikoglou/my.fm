import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";
import { exchangeCode, withAccessToken } from "../spotify";
import { createNewUser } from "../db/queries/users";

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

    // compute expiration
    const expiration = Temporal.Now.instant().add(
      Temporal.Duration.from({ seconds: accessToken.expires_in }),
    );

    await createNewUser({
      name: profile.display_name,
      email: profile.email,
      spotifyAccessToken: accessToken.access_token,
      spotifyRefreshToken: accessToken.refresh_token,
      spotifyTokenExpiration: expiration.epochMilliseconds.toString(),
    });
  },
);
