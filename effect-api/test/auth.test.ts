import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { http } from "msw";
import { describe, expect, test } from "vitest";

import worker from "../src/worker.ts";
import { network } from "./network.ts";

const baseUrl = "http://app.test";

const SocialSignInResponse = Schema.Struct({ url: Schema.String, redirect: Schema.Boolean });

describe("auth routes", () => {
  test("starts Spotify authorization with the configured scopes", async () => {
    const response = await worker.fetch(
      new Request(`${baseUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "spotify" }),
      }),
      env,
    );

    expect(response.status).toBe(200);

    const body = Schema.decodeUnknownSync(SocialSignInResponse)(await response.json());
    const url = new URL(body.url);

    expect(body.redirect).toBe(true);
    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(`${baseUrl}/api/auth/callback/spotify`);
    expect(url.searchParams.get("scope")).toContain("user-read-recently-played");
    expect(url.searchParams.get("scope")).toContain("user-read-currently-playing");
  });

  test("creates a user with a generated username on the first Spotify callback", async () => {
    network.use(
      http.all("https://*.spotify.com/*", ({ request }) => {
        const url = request.url;

        if (url.startsWith("https://accounts.spotify.com/api/token")) {
          return Response.json({
            access_token: "access-token",
            expires_in: 3600,
            refresh_token: "refresh-token",
            scope: "user-read-email",
            token_type: "Bearer",
          });
        }

        if (url.startsWith("https://api.spotify.com/v1/me")) {
          return Response.json({
            display_name: "Spotify User",
            email: "spotify@example.com",
            id: "spotify-user",
            images: [{ url: "https://example.com/avatar.jpg" }],
          });
        }

        throw new Error(`Unexpected fetch: ${url}`);
      }),
    );

    const signIn = await worker.fetch(
      new Request(`${baseUrl}/api/auth/sign-in/social`, {
        method: "POST",
        headers: { "content-type": "application/json", origin: baseUrl },
        body: JSON.stringify({ provider: "spotify", callbackURL: `${baseUrl}/onboard` }),
      }),
      env,
    );

    const { url } = Schema.decodeUnknownSync(SocialSignInResponse)(await signIn.json());
    const state = new URL(url).searchParams.get("state");
    const cookies = signIn.headers.getAll("set-cookie").map((cookie) => cookie.split(";")[0]);

    const callback = await worker.fetch(
      new Request(`${baseUrl}/api/auth/callback/spotify?code=fake-code&state=${state}`, {
        headers: { cookie: cookies.join("; ") },
      }),
      env,
    );

    expect(callback.status).toBe(302);
    expect(callback.headers.get("location")).toBe(`${baseUrl}/onboard`);

    const row = await env.DB.prepare("SELECT username FROM users")
      .bind()
      .first<{ username: string }>();

    expect(row?.username).toBeTypeOf("string");
    expect(row?.username.length).toBeGreaterThan(0);
  });
});
