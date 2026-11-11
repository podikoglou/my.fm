import { Database as SQLite } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";

import type { WorkerEnv } from "../src/alchemy.ts";

export const baseUrl = "http://localhost:1337";

/**
 * A minimal D1 implementation backed by an in-memory SQLite database. It
 * applies the checked-in Drizzle migrations, so tests exercise the same
 * driver, adapter, and schema as the Worker.
 */
export function createTestDatabase(): D1Database {
  const sqlite = new SQLite(":memory:");
  // MIGRATION NOTE: D1 enforces foreign keys; enable the same checks in tests.
  sqlite.exec("PRAGMA foreign_keys = ON");
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
          const boundParams = params as never[];

          return {
            all: async () => ({ results: statement.all(...boundParams) }),
            first: async () => statement.get(...boundParams),
            raw: async () => statement.values(...boundParams),
            run: async () => statement.run(...boundParams),
            execute: () => statement.all(...boundParams),
          };
        },
      };
    },
    // MIGRATION NOTE: Drizzle sends ingestion writes through `batch`. The shim
    // runs the statements in one SQLite transaction so tests see the same
    // all-or-nothing behaviour as D1.
    batch(statements: Array<{ execute: () => unknown[] }>) {
      const execute = sqlite.transaction(() =>
        statements.map((statement) => ({
          success: true,
          results: statement.execute(),
        })),
      );

      return Promise.resolve(execute());
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
