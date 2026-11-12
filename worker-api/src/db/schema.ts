import { defineRelations, sql } from "drizzle-orm";
import { index, integer, primaryKey, sqliteTable, text } from "drizzle-orm/sqlite-core";

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

  lastRecentTracksFetchTime: integer({ mode: "timestamp" }),

  onboarded: integer({ mode: "boolean" }),

  isPrivate: integer({ mode: "boolean" }).default(false).notNull(),
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

export const verification = sqliteTable(
  "verification",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: integer("expires_at", { mode: "timestamp_ms" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
    updatedAt: integer("updated_at", { mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [index("verification_identifier_idx").on(table.identifier)],
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

export const artists = sqliteTable("artists", {
  spotifyUri: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),
  name: text().notNull(),
  imageUrl: text(),
});

export type ArtistInsert = typeof artists.$inferInsert;

export type Artist = typeof artists.$inferSelect;

export const trackArtists = sqliteTable(
  "track_artists",
  {
    trackSpotifyUri: text("track_spotify_uri")
      .notNull()
      .references(() => tracks.spotifyUri),
    artistSpotifyUri: text("artist_spotify_uri")
      .notNull()
      .references(() => artists.spotifyUri),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.trackSpotifyUri, table.artistSpotifyUri] })],
);

export const albumArtists = sqliteTable(
  "album_artists",
  {
    albumSpotifyUri: text("album_spotify_uri")
      .notNull()
      .references(() => albums.spotifyUri),
    artistSpotifyUri: text("artist_spotify_uri")
      .notNull()
      .references(() => artists.spotifyUri),
    position: integer("position").notNull(),
  },
  (table) => [primaryKey({ columns: [table.albumSpotifyUri, table.artistSpotifyUri] })],
);

export const tracks = sqliteTable("tracks", {
  spotifyUri: text().primaryKey(),
  createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

  name: text().notNull(),
  trackNumber: integer(),

  // this is not always known to good precision and sometimes it may be a range
  // rather than a concrete value, so we don't bother properly parsing it
  releaseDate: text().notNull(),

  imageUrl: text().notNull(),

  // I can't tell if the API is required to give this or not but it's a shame to make it nullable
  explicit: integer({ mode: "boolean" }).default(false),

  // I can't tell if the API is required to give this or not but it's a shame to make it nullable
  duration: integer().default(0),
});

export type TrackInsert = typeof tracks.$inferInsert;

export type Track = typeof tracks.$inferSelect;

export const relations = defineRelations(
  {
    users,
    sessions,
    accounts,
    verification,
    scrobbles,
    albums,
    artists,
    trackArtists,
    albumArtists,
    tracks,
  },
  (r) => ({
    users: {
      scrobbles: r.many.scrobbles({ from: r.users.id, to: r.scrobbles.userId }),
      sessions: r.many.sessions({ from: r.users.id, to: r.sessions.userId }),
      accounts: r.many.accounts({ from: r.users.id, to: r.accounts.userId }),
    },
    sessions: {
      user: r.one.users({ from: r.sessions.userId, to: r.users.id, optional: false }),
    },
    accounts: {
      user: r.one.users({ from: r.accounts.userId, to: r.users.id, optional: false }),
    },
    scrobbles: {
      user: r.one.users({ from: r.scrobbles.userId, to: r.users.id, optional: false }),
      track: r.one.tracks({
        from: r.scrobbles.trackSpotifyUri,
        to: r.tracks.spotifyUri,
        optional: false,
      }),
      album: r.one.albums({
        from: r.scrobbles.albumSpotifyUri,
        to: r.albums.spotifyUri,
        optional: false,
      }),
    },
    albums: {
      scrobbles: r.many.scrobbles({ from: r.albums.spotifyUri, to: r.scrobbles.albumSpotifyUri }),
      albumArtists: r.many.albumArtists({
        from: r.albums.spotifyUri,
        to: r.albumArtists.albumSpotifyUri,
      }),
    },
    artists: {
      trackArtists: r.many.trackArtists({
        from: r.artists.spotifyUri,
        to: r.trackArtists.artistSpotifyUri,
      }),
      albumArtists: r.many.albumArtists({
        from: r.artists.spotifyUri,
        to: r.albumArtists.artistSpotifyUri,
      }),
    },
    trackArtists: {
      track: r.one.tracks({
        from: r.trackArtists.trackSpotifyUri,
        to: r.tracks.spotifyUri,
        optional: false,
      }),
      artist: r.one.artists({
        from: r.trackArtists.artistSpotifyUri,
        to: r.artists.spotifyUri,
        optional: false,
      }),
    },
    albumArtists: {
      album: r.one.albums({
        from: r.albumArtists.albumSpotifyUri,
        to: r.albums.spotifyUri,
        optional: false,
      }),
      artist: r.one.artists({
        from: r.albumArtists.artistSpotifyUri,
        to: r.artists.spotifyUri,
        optional: false,
      }),
    },
    tracks: {
      scrobbles: r.many.scrobbles({ from: r.tracks.spotifyUri, to: r.scrobbles.trackSpotifyUri }),
      trackArtists: r.many.trackArtists({
        from: r.tracks.spotifyUri,
        to: r.trackArtists.trackSpotifyUri,
      }),
    },
  }),
);
