import type { D1Database } from "@cloudflare/workers-types";

import { drizzle } from "drizzle-orm/d1";

import { relations } from "./schema.ts";

/**
 * Create a Drizzle client for the D1 binding.
 *
 * D1 bindings belong to one request's environment, so a client cannot be a
 * module singleton. Call this once per request and pass the result down.
 */
export function createDatabase(database: D1Database) {
  return drizzle(database, { relations });
}

export type Database = ReturnType<typeof createDatabase>;
