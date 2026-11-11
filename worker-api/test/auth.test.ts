import { Database as SQLite } from "bun:sqlite";
import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import type { WorkerEnv } from "../alchemy.run.ts";

import { createApp } from "../src/app.ts";

/**
 * A minimal D1 implementation backed by an in-memory SQLite database. It
 * applies the checked-in Drizzle migrations, so tests exercise the same
 * driver, adapter, and schema as the Worker.
 */
function createTestDatabase(): D1Database {
  const sqlite = new SQLite(":memory:");
  const directory = new URL("../drizzle/", import.meta.url);

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    sqlite.exec(readFileSync(new URL(`${entry.name}/migration.sql`, directory), "utf8"));
  }

  return {
    prepare(sql: string) {
      const statement = sqlite.query(sql);

      return {
        bind(...params: unknown[]) {
          return {
            all: async () => ({ results: statement.all(...(params as never[])) }),
            first: async () => statement.get(...(params as never[])),
            raw: async () => statement.values(...(params as never[])),
            run: async () => statement.run(...(params as never[])),
          };
        },
      };
    },
  } as unknown as D1Database;
}

const baseUrl = "http://localhost:1337";

const env = {
  DB: createTestDatabase(),
  BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
  BETTER_AUTH_URL: baseUrl,
  FRONTEND_URL: "http://localhost:3000",
  SPOTIFY_CLIENT_ID: "test-client-id",
  SPOTIFY_CLIENT_SECRET: "test-client-secret",
  SPOTIFY_REDIRECT_URI: `${baseUrl}/api/auth/callback/spotify`,
} as unknown as WorkerEnv;

describe("auth routes", () => {
  test("returns no session without a session cookie", async () => {
    const response = await createApp().request("/api/auth/get-session", undefined, env);

    expect(response.status).toBe(200);
    expect(await response.json()).toBe(null);
  });

  test("starts Spotify authorization with the configured scopes", async () => {
    const response = await createApp().request(
      "/api/auth/sign-in/social",
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
