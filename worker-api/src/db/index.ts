import type { D1Database } from "@cloudflare/workers-types";

import { drizzle } from "drizzle-orm/d1";

import { relations } from "./schema.ts";

/** Create a Drizzle client for the D1 binding. */
export function createDatabase(database: D1Database) {
  return drizzle(database, { relations });
}

export type Database = ReturnType<typeof createDatabase>;
