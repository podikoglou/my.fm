import { sql } from "drizzle-orm";
import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  name: text().notNull(),
  email: text().notNull().unique(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

  avatarUrl: text(),

  spotifyAccessToken: text(),
  spotifyRefreshToken: text(),
  spotifyTokenExpiration: text(),

  onboarded: integer({ mode: "boolean" }),
});

export type UserInsert = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const scrobbles = sqliteTable("scrobbles", {
  id: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

  userId: text()
    .notNull()
    .references(() => users.id),

  trackSpotifyUri: text().notNull(),
  albumSpotifyUri: text().notNull(),

  scrobbleDate: integer({ mode: "timestamp" }),
});

export type ScrobbleInsert = typeof scrobbles.$inferInsert;
export type Scrobble = typeof scrobbles.$inferSelect;

export const albums = sqliteTable("albums", {
  spotifyUri: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

  name: text().notNull(),

  // this is not always known to good precision and sometimes it may be a range
  // rather than a concrete value, so we don't bother properly parsing it
  releaseDate: text().notNull(),

  totalTracks: integer().notNull(),

  albumType: text().notNull(),
  imageUrl: text().notNull(),
});

export type AlbumInsert = typeof albums.$inferInsert;
export type Album = typeof albums.$inferSelect;
