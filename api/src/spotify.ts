import { SpotifyApi, type AccessToken } from "@spotify/web-api-ts-sdk";

import { env } from "./env";
import ky from "ky";

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
  // for whatever, @spotify/the web-api-ts-sdk  doesn't seem to provide this or maybe I'm blind
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
