import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  name: text().notNull(),
  email: text().notNull(),
  createdAt: integer({ mode: "timestamp" }).default(sql`now()`),

  spotifyAccessCode: text(),
  spotifyRefreshToken: text(),
  spotifyTokenExpiration: text(),

  onboarded: integer({ mode: "boolean" }),
});

export const scrobbles = sqliteTable("scrobbles", {
  id: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }),

  userId: text()
    .notNull()
    .references(() => users.id),

  spotifyUri: text().notNull(),
});
