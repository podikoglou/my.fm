import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { http } from "msw";
import { expect } from "vitest";

import { SPOTIFY_SCOPES } from "../src/auth/service.ts";
import worker from "../src/worker.ts";
import { queryRows } from "./d1.ts";
import { network } from "./network.ts";

export const baseUrl = "https://app.test";

const SocialSignInResponse = Schema.Struct({ url: Schema.String });

/**
 * Sign in through the real OAuth flow against a Spotify fixture, and return
 * the session cookie with the user that the callback created.
 */
export async function signIn(spotify: {
  id: string;
  email: string;
  /** The scopes Spotify's token response grants, space-separated. */
  scope?: string;
  callbackURL?: string;
}): Promise<{ cookie: string; userId: string }> {
  const callbackURL = spotify.callbackURL ?? `${baseUrl}/onboard`;

  network.use(
    http.all("https://*.spotify.com/*", ({ request }) => {
      const url = request.url;

      if (url.startsWith("https://accounts.spotify.com/api/token")) {
        return Response.json({
          access_token: "access-token",
          expires_in: 3600,
          refresh_token: "refresh-token",
          scope: spotify.scope ?? SPOTIFY_SCOPES.join(" "),
          token_type: "Bearer",
        });
      }

      if (url.startsWith("https://api.spotify.com/v1/me")) {
        return Response.json({
          display_name: "Test User",
          email: spotify.email,
          id: spotify.id,
          images: [],
        });
      }

      throw new Error(`Unexpected fetch: ${url}`);
    }),
  );

  const signInResponse = await worker.fetch(
    new Request(`${baseUrl}/api/auth/sign-in/social`, {
      method: "POST",
      headers: { "content-type": "application/json", origin: baseUrl },
      body: JSON.stringify({ provider: "spotify", callbackURL }),
    }),
    env,
  );

  const { url } = Schema.decodeUnknownSync(SocialSignInResponse)(await signInResponse.json());
  const state = new URL(url).searchParams.get("state");
  const cookies = signInResponse.headers.getAll("set-cookie").map((cookie) => cookie.split(";")[0]);

  const callback = await worker.fetch(
    new Request(`${baseUrl}/api/auth/callback/spotify?code=fake-code&state=${state}`, {
      headers: { cookie: cookies.join("; ") },
    }),
    env,
  );

  expect(callback.status).toBe(302);
  expect(callback.headers.get("location")).toBe(callbackURL);

  const sessionCookies = callback.headers
    .getAll("set-cookie")
    .map((cookie) => cookie.split(";")[0]);

  const [user] = await queryRows<{ id: string }>(env.DB, "SELECT id FROM users WHERE email = ?", [
    spotify.email,
  ]);

  if (!user) {
    throw new Error("The Spotify callback did not create a user");
  }

  return { cookie: sessionCookies.join("; "), userId: user.id };
}
