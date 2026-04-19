import { relations } from "drizzle-orm";
import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: text().primaryKey(),
  username: text().notNull().unique(),
  name: text().notNull(),
  email: text().notNull().unique(),
  emailVerified: integer("email_verified", { mode: "boolean" }).default(false).notNull(),

  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" })
    .$onUpdate(() => new Date())
    .notNull(),

  avatarUrl: text(),

  spotifyAccessToken: text(),
  spotifyRefreshToken: text(),
  spotifyTokenExpiration: integer({ mode: "timestamp" }),
  lastRecentTracksFetchTime: integer({ mode: "timestamp" }),

  onboarded: integer({ mode: "boolean" }),
});

export type UserInsert = typeof users.$inferInsert;
export type User = typeof users.$inferSelect;

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    token: text("token").notNull().unique(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [index("session_userId_idx").on(table.userId)],
);

export const accounts = sqliteTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: integer("access_token_expires_at", {
      mode: "timestamp_ms",
    }),
    refreshTokenExpiresAt: integer("refresh_token_expires_at", {
      mode: "timestamp_ms",
    }),
    scope: text("scope"),
    password: text("password"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("account_userId_idx").on(table.userId)],
);
export const scrobbles = sqliteTable("scrobbles", {
  id: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

  userId: text()
    .notNull()
    .references(() => users.id),

  trackSpotifyUri: text()
    .notNull()
    .references(() => tracks.spotifyUri),

  albumSpotifyUri: text()
    .notNull()
    .references(() => albums.spotifyUri),

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

export const tracks = sqliteTable("tracks", {
  spotifyUri: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

  name: text().notNull(),
  trackNumber: integer(),

  // this is not always known to good precision and sometimes it may be a range
  // rather than a concrete value, so we don't bother properly parsing it
  releaseDate: text().notNull(),

  totalTracks: integer().notNull(),

  albumType: text().notNull(),
  imageUrl: text().notNull(),

  // I can't tell if the API is required to give this or not but it's a shame to make it nullable
  explicit: integer({ mode: "boolean" }).default(false),

  // I can't tell if the API is required to give this or not but it's a shame to make it nullable
  duration: integer().default(0),
});

export type TrackInsert = typeof tracks.$inferInsert;
export type Track = typeof tracks.$inferSelect;

export const usersRelations = relations(users, ({ many }) => ({
  scrobbles: many(scrobbles),
}));

export const scrobblesRelations = relations(scrobbles, ({ one }) => ({
  user: one(users, {
    fields: [scrobbles.userId],
    references: [users.id],
  }),
  track: one(tracks, {
    fields: [scrobbles.trackSpotifyUri],
    references: [tracks.spotifyUri],
  }),
  album: one(albums, {
    fields: [scrobbles.albumSpotifyUri],
    references: [albums.spotifyUri],
  }),
}));

export const albumsRelations = relations(albums, ({ many }) => ({
  scrobbles: many(scrobbles),
}));

export const tracksRelations = relations(tracks, ({ many }) => ({
  scrobbles: many(scrobbles),
}));
