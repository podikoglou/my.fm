import { drizzle } from "drizzle-orm/d1";

import { relations } from "./schema.ts";

/**
 * Create a Drizzle client for the bound D1 database.
 *
 * D1 bindings belong to a request's environment, so the client is created per
 * request rather than once at module scope.
 */
export function createDatabase(database: D1Database) {
  return drizzle(database, { relations });
}

export type Database = ReturnType<typeof createDatabase>;
