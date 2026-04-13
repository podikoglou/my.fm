import { drizzle } from "drizzle-orm/libsql";
import { env } from "../env";
import { drizzleLogger } from "../logger";
import * as schema from "./schema";

export const db = drizzle(env.DATABASE_URL, { schema, logger: drizzleLogger });
