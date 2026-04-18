import { SpotifyApi, type AccessToken } from "@spotify/web-api-ts-sdk";

import { env } from "./env";
import ky from "ky";
import z from "zod";
import { add, differenceInSeconds } from "date-fns";

// z.infer<typeof accessTokenSchema> should be equal to AccessToken (from @spotify/web-api-ts-sdk)
export const accessTokenSchema = z.object({
  access_token: z.string(),
  token_type: z.string().default("Bearer"),
  expires_in: z.number(),
  refresh_token: z.string(),
  expires: z.number().optional(),
});

export const userDataToAccessToken = z.codec(
  z.object({
    spotifyAccessToken: z.string(),
    spotifyRefreshToken: z.string(),
    spotifyTokenExpiration: z.date(),
  }),
  accessTokenSchema,
  {
    decode: ({ spotifyAccessToken, spotifyRefreshToken, spotifyTokenExpiration }) => {
      const expiresInSeconds = differenceInSeconds(spotifyTokenExpiration, new Date());

      return {
        access_token: spotifyAccessToken,
        refresh_token: spotifyRefreshToken,

        // Math.floor to ensure integer, Math.max to clamp negative times to 0 if already expired
        expires_in: Math.max(0, Math.floor(expiresInSeconds)),
      };
    },
    encode: ({ access_token, refresh_token, expires_in }) => ({
      spotifyAccessToken: access_token,
      spotifyRefreshToken: refresh_token,
      spotifyTokenExpiration: add(new Date(), { seconds: expires_in }),
    }),
  },
);

/**
 * Given the access token from a user (which we get by exchanging the authorization code for it),
 * creates a Spotify API client we can use which also includes our client ID
 */
export function withAccessToken(accessToken: AccessToken) {
  return SpotifyApi.withAccessToken(env.SPOTIFY_CLIENT_ID, accessToken);
}

/*
 * Exchanges an authorization code (which we got from the redirect) for an access token.
 */
export async function exchangeCode(code: string): Promise<AccessToken> {
  // for whatever reason, @spotify/the web-api-ts-sdk  doesn't seem to provide this or maybe I'm blind
  return (
    ky
      .post("https://accounts.spotify.com/api/token", {
        headers: {
          Authorization:
            "Basic " +
            Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64"),
        },
        body: new URLSearchParams({
          grant_type: "authorization_code",
          code,
          redirect_uri: env.SPOTIFY_REDIRECT_URI,
        }),
      })
      // notes:
      // 1) AccessToken is not a string as one would expect (it's not *just* the access token) but an object
      //    that contains the refresh token, expiry time and token type
      //
      // 2) AccessToken is not exactly the shape of the response (the "scope" is also returned and that's not
      //    contained in AccessToken, but we don't care about it much) but it's more convenient to use this type
      //    than to create our own
      .json<AccessToken>()
  );
}

/**
 * Exchagnes a refresh access token for a new AccessToken
 */
export async function refreshAccessToken(refreshToken: string): Promise<AccessToken> {
  return ky
    .post("https://accounts.spotify.com/api/token", {
      headers: {
        Authorization:
          "Basic " +
          Buffer.from(`${env.SPOTIFY_CLIENT_ID}:${env.SPOTIFY_CLIENT_SECRET}`).toString("base64"),
      },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    })
    .json<AccessToken>();
}

const REFRESH_THRESHOLD_SECONDS = 60;

/**
 * Refreshes an AccessToken if it is near / past its expiration, or else return it as it is.
 */
export async function ensureFreshAccessToken(
  accessToken: AccessToken,
  onRefresh?: (newToken: AccessToken) => Promise<void>,
): Promise<AccessToken> {
  if (accessToken.expires_in > REFRESH_THRESHOLD_SECONDS) {
    return accessToken;
  }

  const newToken = await refreshAccessToken(accessToken.refresh_token);

  if (onRefresh) {
    await onRefresh(newToken);
  }

  return newToken;
}
