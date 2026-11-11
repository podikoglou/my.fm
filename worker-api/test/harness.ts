import { Database as SQLite } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";

import type { WorkerEnv } from "../alchemy.run.ts";

export const baseUrl = "http://localhost:1337";

/**
 * A minimal D1 implementation backed by an in-memory SQLite database. It
 * applies the checked-in Drizzle migrations, so tests exercise the same
 * driver, adapter, and schema as the Worker.
 */
export function createTestDatabase(): D1Database {
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

/** Create a Worker environment for a test, with a fresh migrated database. */
export function createTestEnv(database: D1Database = createTestDatabase()): WorkerEnv {
  return {
    DB: database,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    BETTER_AUTH_URL: baseUrl,
    FRONTEND_URL: "http://localhost:3000",
    SPOTIFY_CLIENT_ID: "test-client-id",
    SPOTIFY_CLIENT_SECRET: "test-client-secret",
    SPOTIFY_REDIRECT_URI: `${baseUrl}/api/auth/callback/spotify`,
  } as unknown as WorkerEnv;
}
