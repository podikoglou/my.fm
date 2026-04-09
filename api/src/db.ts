import { drizzle } from "drizzle-orm/libsql";

// TODO: type ensafe this
export const db = drizzle(process.env.DATABASE_URL!);
