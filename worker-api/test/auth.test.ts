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
});
