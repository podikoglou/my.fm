import { SpotifyApi, type AccessToken } from "@spotify/web-api-ts-sdk";

import { env } from "./env";

export function withAccessToken(accessToken: AccessToken) {
  return SpotifyApi.withAccessToken(env.SPOTIFY_CLIENT_ID, accessToken);
}
