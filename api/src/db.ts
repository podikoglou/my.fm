import { drizzle } from "drizzle-orm/libsql";
import { env } from "./env";

// TODO: type ensafe this
export const db = drizzle(env.DATABASE_URL);
