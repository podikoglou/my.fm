import type { SQLQueryBindings } from "bun:sqlite";

import { Database as SQLite } from "bun:sqlite";
import { spyOn } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";

import type { WorkerEnv } from "../src/alchemy.ts";
import type { IngestionEventFields } from "../src/ingestion/events.ts";

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

function asR2Bucket<T>(value: T): R2Bucket {
  // SAFETY: `value` implements get, put, and delete that the import code calls;
  // the rest of the R2 interface is unreachable in these tests.
  return value as R2Bucket;
}

export function createTestR2Bucket(): R2Bucket {
  const store = new Map<string, { body: Uint8Array; httpMetadata?: R2PutOptions }>();

  return asR2Bucket({
    async get(key: string) {
      const item = store.get(key);

      if (!item) {
        return null;
      }

      const body = item.body;
      const text = new TextDecoder().decode(body);

      return {
        key,
        async text() {
          return text;
        },
        async arrayBuffer() {
          return body.buffer;
        },
      };
    },
    async put(key: string, value: string | ArrayBuffer | ArrayBufferView, options?: R2PutOptions) {
      let body: Uint8Array;

      if (value instanceof ArrayBuffer) {
        body = new Uint8Array(value);
      } else if (ArrayBuffer.isView(value)) {
        body = new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
      } else {
        body = new TextEncoder().encode(value);
      }

      store.set(key, { body, httpMetadata: options });

      return null;
    },
    async delete(key: string) {
      store.delete(key);
    },
  });
}

/** Create a Worker environment for a test, with a fresh migrated database. */
export function createTestEnv(
  database: D1Database = createTestDatabase(),
  bucket: R2Bucket = createTestR2Bucket(),
): WorkerEnv {
  return {
    DB: database,
    IMPORTS_BUCKET: bucket,
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
 * Capture the ingestion log output and keep it out of the test output.
 *
 * Normal events are one object; failures are an event name followed by an
 * optional detail.
 */
export function captureLogs() {
  const events: IngestionEventFields[] = [];
  const messages: unknown[][] = [];

  const recordEvent = (fields: IngestionEventFields) => {
    events.push(fields);
  };

  const recordMessage = (...args: unknown[]) => {
    messages.push(args);
  };

  const spies = [
    spyOn(console, "log").mockImplementation(recordEvent),
    spyOn(console, "warn").mockImplementation(recordMessage),
    spyOn(console, "error").mockImplementation(recordMessage),
  ];

  return {
    events,
    messages,
    named: (event: string) => events.filter((entry) => entry.event === event),
    restore: () => {
      for (const spy of spies) {
        spy.mockRestore();
      }
    },
  };
}

/**
 * The exact message the D1 binding throws once the account exceeds its daily
 * free-tier write limit.
 */
const D1_WRITE_LIMIT_MESSAGE =
  "D1_ERROR: Your account has exceeded D1's free tier daily row write limit. " +
  "Upgrade to a paid plan or wait until tomorrow (midnight UTC) to continue. " +
  "See https://developers.cloudflare.com/d1/platform/limits/ for more details.";

/** SQL that D1 counts as written rows. */
const writeStatementPattern = /^(insert|update|delete)\b/i;

/**
 * A statement that rejects like the binding does. The methods return rejected
 * promises because a synchronous throw skips Drizzle's error wrapper and
 * would not reproduce the wrapped shape that production sees.
 */
function rejectingStatement(message: string) {
  const reject = () => {
    throw new Error(message);
  };

  const statement = {
    bind: () => statement,
    all: async () => reject(),
    first: async () => reject(),
    raw: async () => reject(),
    run: async () => reject(),
    execute: () => reject(),
  };

  return statement;
}

/**
 * A database whose `batch` rejects with the D1 write-limit error, as the
 * binding does once the account exceeds its daily row writes. Single
 * statements run for real, so a test can seed and assert through the tables.
 */
export function createBatchWriteLimitDatabase(
  database: D1Database = createTestDatabase(),
): D1Database {
  return asD1Database({
    prepare(sql: string) {
      return database.prepare(sql);
    },
    batch(_statements: D1PreparedStatement[]) {
      return Promise.reject(new Error(D1_WRITE_LIMIT_MESSAGE));
    },
  });
}

/**
 * A database whose write statements reject with the D1 write-limit error, so
 * Drizzle wraps the message in a `DrizzleQueryError` with the binding error as
 * its cause. Reads pass through.
 */
export function createStatementWriteLimitDatabase(
  database: D1Database = createTestDatabase(),
): D1Database {
  return asD1Database({
    prepare(sql: string) {
      return writeStatementPattern.test(sql)
        ? rejectingStatement(D1_WRITE_LIMIT_MESSAGE)
        : database.prepare(sql);
    },
    batch(statements: D1PreparedStatement[]) {
      return database.batch(statements);
    },
  });
}

/**
 * A database whose update statements reject with the given error, while
 * inserts and reads pass through.
 */
export function createFailingUpdateDatabase(
  message: string,
  database: D1Database = createTestDatabase(),
): D1Database {
  return asD1Database({
    prepare(sql: string) {
      return /^update\b/i.test(sql) ? rejectingStatement(message) : database.prepare(sql);
    },
    batch(statements: D1PreparedStatement[]) {
      return database.batch(statements);
    },
  });
}

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
