import { describe, expect, test } from "bun:test";

import { createApp } from "../src/app.ts";
import { baseUrl, createTestEnv } from "./harness.ts";

const env = createTestEnv();

describe("auth routes", () => {
  test("returns no session without a session cookie", async () => {
    const response = await createApp().request(`${baseUrl}/api/auth/get-session`, undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toBe(null);
  });

  test("starts Spotify authorization with the configured scopes", async () => {
    const response = await createApp().request(
      `${baseUrl}/api/auth/sign-in/social`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ provider: "spotify" }),
      },
      env,
    );

    expect(response.status).toBe(200);

    const body = (await response.json()) as { url: string; redirect: boolean };
    const url = new URL(body.url);

    expect(body.redirect).toBe(true);
    expect(url.origin).toBe("https://accounts.spotify.com");
    expect(url.searchParams.get("client_id")).toBe("test-client-id");
    expect(url.searchParams.get("redirect_uri")).toBe(`${baseUrl}/api/auth/callback/spotify`);
    expect(url.searchParams.get("scope")).toContain("user-read-recently-played");
  });

  test("creates a user with a generated username on the first Spotify callback", async () => {
    const testEnv = createTestEnv();
    const originalFetch = globalThis.fetch;

    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

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
    }) as typeof fetch;

    try {
      const app = createApp();
      const signIn = await app.request(
        `${baseUrl}/api/auth/sign-in/social`,
        {
          method: "POST",
          headers: { "content-type": "application/json", origin: baseUrl },
          body: JSON.stringify({ provider: "spotify", callbackURL: `${baseUrl}/onboard` }),
        },
        testEnv,
      );
      const { url } = (await signIn.json()) as { url: string };
      const state = new URL(url).searchParams.get("state");
      const cookies = signIn.headers.getSetCookie().map((cookie) => cookie.split(";")[0]);

      const callback = await app.request(
        `${baseUrl}/api/auth/callback/spotify?code=fake-code&state=${state}`,
        { headers: { cookie: cookies.join("; ") } },
        testEnv,
      );

      expect(callback.status).toBe(302);
      expect(callback.headers.get("location")).toBe(`${baseUrl}/onboard`);

      const row = (await testEnv.DB.prepare("SELECT username FROM users").bind().first()) as {
        username: string;
      } | null;

      expect(row?.username).toBeString();
      expect(row?.username.length).toBeGreaterThan(0);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
