import { redirect } from "react-router";

const ENDPOINT = "https://accounts.spotify.com";
const AUTHORIZE_ENDPOINT = `${ENDPOINT}/authorize`;
const SCOPE = "user-read-private user-read-email";

export const makeSpotifyAuthorizeUrl = () => {
  // construct URL
  const authUrl = new URL(AUTHORIZE_ENDPOINT);

  const params = {
    response_type: "code",
    client_id: import.meta.env.VITE_SPOTIFY_CLIENT_ID,
    scope: SCOPE,
    redirect_uri: import.meta.env.VITE_SPOTIFY_REDIRECT_URI,
  };

  authUrl.search = new URLSearchParams(params).toString();

  return authUrl;
};

export const authorizeSpotify = () => {
  const url = makeSpotifyAuthorizeUrl();
  throw redirect(url.toString());
};
