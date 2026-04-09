import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const usersTable = sqliteTable("users", {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  name: text().notNull(),
  email: text().notNull(),
  createdAt: integer({ mode: "timestamp" }),

  spotifyAccessCode: text(),
  spotifyRefreshToken: text(),
  spotifyTokenExpiration: text(),

  onboarded: integer({ mode: "boolean" }),
});
