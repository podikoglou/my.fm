import { Database as SQLite } from "bun:sqlite";
import { readdirSync, readFileSync } from "node:fs";

import type { SQLQueryBindings } from "bun:sqlite";

import type { WorkerEnv } from "../src/alchemy.ts";

export const baseUrl = "http://app.test";

/**
 * A minimal D1 implementation backed by an in-memory SQLite database. It
 * applies the checked-in Drizzle migrations, so tests exercise the same
 * driver, adapter, and schema as the Worker.
 *
 * `onBatch` observes each batch, so a test can assert how Drizzle groups
 * writes.
 */
export function createTestDatabase(onBatch?: () => void): D1Database {
  const sqlite = new SQLite(":memory:");
  // D1 enforces foreign keys; enable the same checks in tests.
  sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);

  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;

    sqlite.exec(readFileSync(new URL(`${entry.name}/migration.sql`, directory), "utf8"));
  }

  return asD1Database({
    prepare(sql: string) {
      const statement = sqlite.query(sql);

      const prepareWithParams = (params: SQLQueryBindings[]) => ({
        bind(...values: SQLQueryBindings[]) {
          return prepareWithParams(values);
        },
        all: async () => ({ results: statement.all(...params) }),
        first: async () => statement.get(...params),
        raw: async () => statement.values(...params),
        run: async () => statement.run(...params),
        execute: () => statement.all(...params),
      });

      return prepareWithParams([]);
    },
    // Drizzle sends ingestion writes through `batch`. The shim runs the
    // statements in one SQLite transaction so tests see the same all-or-nothing
    // behaviour as D1.
    batch(statements: Array<{ execute: () => unknown[] }>) {
      onBatch?.();

      const execute = sqlite.transaction(() =>
        statements.map((statement) => ({
          success: true,
          results: statement.execute(),
        })),
      );

      return Promise.resolve(execute());
    },
  });
}

/**
 * Treat a structural test double as the full Cloudflare binding type. The
 * double implements the subset of the interface that the tested code calls.
 */
function asD1Database<T>(value: T): D1Database {
  // SAFETY: `value` implements every D1 method that the tested code calls; the
  // rest of the binding interface is unreachable in these tests.
  return value as D1Database;
}

/** Create a Worker environment for a test, with a fresh migrated database. */
export function createTestEnv(database: D1Database = createTestDatabase()): WorkerEnv {
  return {
    DB: database,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    SPOTIFY_CLIENT_ID: "test-client-id",
    SPOTIFY_CLIENT_SECRET: "test-client-secret",
  };
}

type FetchHandler = (
  input: Parameters<typeof fetch>[0],
  init?: Parameters<typeof fetch>[1],
) => Promise<Response>;

/**
 * Replace the global fetch for the duration of a test. The returned function
 * restores the original fetch.
 */
export function replaceFetch(handler: FetchHandler): () => void {
  const original = globalThis.fetch;
  globalThis.fetch = Object.assign(handler, { preconnect: original.preconnect });

  return () => {
    globalThis.fetch = original;
  };
}
