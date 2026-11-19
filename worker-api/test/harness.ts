import type { SQLInputValue } from "node:sqlite";

import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync as SQLite } from "node:sqlite";

import type { WorkerEnv } from "../src/alchemy.ts";
import type { RateLimiter } from "../src/rate-limits.ts";

export const baseUrl = "http://app.test";

/**
 * Create an in-memory D1 database with the checked-in migrations.
 *
 * The shim applies the same migrations as the Worker and uses the same Drizzle
 * adapter, so a passing test exercises the production query path. `onBatch`
 * observes each batch call, so a test can assert how Drizzle groups writes.
 */
export function createTestDatabase(onBatch?: () => void): D1Database {
  const sqlite = new SQLite(":memory:");
  // D1 enforces foreign keys; enable the same checks in tests.
  sqlite.exec("PRAGMA foreign_keys = ON");
  const directory = new URL("../drizzle/", import.meta.url);

  // `readdirSync` returns filesystem order, which differs between checkouts.
  // Drizzle names each directory by its timestamp, so sorting by name is the
  // order that the migrations must run in.
  const migrations = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .sort((a, b) => a.name.localeCompare(b.name));

  for (const entry of migrations) {
    sqlite.exec(readFileSync(new URL(`${entry.name}/migration.sql`, directory), "utf8"));
  }

  return asD1Database({
    prepare(sql: string) {
      const statement = sqlite.prepare(sql);

      const prepareWithParams = (params: SQLInputValue[]) => ({
        bind(...values: SQLInputValue[]) {
          return prepareWithParams(values);
        },
        all: async () => ({ results: statement.all(...params) }),
        first: async () => statement.get(...params),
        raw: async () => {
          statement.setReturnArrays(true);

          return statement.all(...params);
        },
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

      sqlite.exec("BEGIN");

      try {
        const results = statements.map((statement) => ({
          success: true,
          results: statement.execute(),
        }));

        sqlite.exec("COMMIT");

        return Promise.resolve(results);
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
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
export function createTestEnv(options: TestEnvOptions = {}): WorkerEnv {
  const {
    database = createTestDatabase(),
    authRateLimiter = createRateLimiter(),
    publicReadRateLimiter = createRateLimiter(),
  } = options;

  return {
    DB: database,
    AUTH_RATE_LIMIT: authRateLimiter,
    PUBLIC_READ_RATE_LIMIT: publicReadRateLimiter,
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret",
    SPOTIFY_CLIENT_ID: "test-client-id",
    SPOTIFY_CLIENT_SECRET: "test-client-secret",
  };
}

type TestEnvOptions = {
  database?: D1Database;
  authRateLimiter?: RateLimiter;
  publicReadRateLimiter?: RateLimiter;
};

/**
 * An in-memory counter that stands in for the Rate Limiting binding: one count
 * per key, and a request above `limit` is denied without counting, as the
 * binding documents. The default budget exceeds every declared policy, so a
 * test that does not care about throttling never trips it; a limit of `0`
 * denies every request, which pins a route that must never consult one.
 */
export function createRateLimiter(limit = 1_000): RateLimiter {
  const counts = new Map<string, number>();

  return {
    async limit({ key }) {
      const count = counts.get(key) ?? 0;

      if (count >= limit) {
        return { success: false };
      }

      counts.set(key, count + 1);

      return { success: true };
    },
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
