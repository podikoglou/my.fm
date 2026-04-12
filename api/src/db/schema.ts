import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  name: text().notNull(),
  email: text().notNull().unique(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

  spotifyAccessToken: text(),
  spotifyRefreshToken: text(),
  spotifyTokenExpiration: text(),

  onboarded: integer({ mode: "boolean" }),
});

export type UserInsert = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const scrobbles = sqliteTable("scrobbles", {
  id: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }),

  userId: text()
    .notNull()
    .references(() => users.id),

  spotifyUri: text().notNull(),
});

export type ScrobbleInsert = typeof scrobbles.$inferInsert;
export type Scrobble = typeof scrobbles.$inferSelect;
