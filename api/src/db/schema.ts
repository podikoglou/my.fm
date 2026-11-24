import { defineRelations, sql } from "drizzle-orm";
import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

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

  lastFetchedAt: integer({ mode: "timestamp_ms" }),

  lastActiveAt: integer({ mode: "timestamp_ms" }),

  onboarded: integer({ mode: "boolean" }),

  isPrivate: integer({ mode: "boolean" }).default(false).notNull(),
});

export type UserInsert = typeof users.$inferInsert;

export type User = typeof users.$inferSelect;

/**
 * One row, written after every Cron Trigger run. `/health/ingestion` reads it
 * so an uptime monitor can tell a stopped schedule from a healthy one: a run
 * that never starts cannot log, and therefore cannot alert.
 */
export const ingestionRuns = sqliteTable("ingestion_runs", {
  id: integer().primaryKey(),
  lastRunAt: integer({ mode: "timestamp_ms" }).notNull(),
  status: text().notNull(),
  /**
   * The instant when Spotify accepts requests again, while a block lasts. A run
   * reads it before it does any work, so a blocked application receives no
   * requests. Null outside a block.
   */
  blockedUntil: integer({ mode: "timestamp_ms" }),
});

export type IngestionRun = typeof ingestionRuns.$inferSelect;

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

export const scrobbles = sqliteTable(
  "scrobbles",
  {
    id: text().primaryKey(),
    createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),

    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),

    trackSpotifyUri: text().references(() => tracks.spotifyUri),

    albumSpotifyUri: text().references(() => albums.spotifyUri),

    coverArtUrl: text(),
    artistName: text(),
    albumName: text(),
    trackName: text(),
    normArtistKey: text(),
    normTrackKey: text(),

    scrobbleDate: integer({ mode: "timestamp" }),
    importId: text().references(() => imports.id, { onDelete: "cascade" }),
  },
  // The public feed reads every user's scrobbles in play-time order. The ID
  // breaks ties inside one second, so the keyset cursor is exact. A profile
  // reads one user's scrobbles in the same order.
  (table) => [
    index("scrobbles_scrobble_date_id_idx").on(table.scrobbleDate, table.id),
    index("scrobbles_user_id_scrobble_date_id_idx").on(table.userId, table.scrobbleDate, table.id),
  ],
);

export type ScrobbleInsert = typeof scrobbles.$inferInsert;

export type Scrobble = typeof scrobbles.$inferSelect;

export const imports = sqliteTable(
  "imports",
  {
    id: text().primaryKey(),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    filename: text().notNull(),
    status: text({ enum: ["pending", "processing", "completed", "failed"] }).notNull(),
    cursor: integer().notNull().default(0),
    totalLines: integer(),
    processedRows: integer().notNull().default(0),
    skippedRows: integer().notNull().default(0),
    /**
     * Consecutive cron runs that ended in a caught batch failure. The cron
     * processor abandons the import when this reaches its attempt limit, so a
     * persistently failing resolver cannot wedge the queue behind it.
     */
    attemptCount: integer().notNull().default(0),
    error: text(),
    createdAt: integer({ mode: "timestamp" }).default(sql`(unixepoch())`),
    updatedAt: integer({ mode: "timestamp_ms" })
      .$onUpdate(() => new Date())
      .notNull(),
  },
  (table) => [
    index("imports_status_created_at_idx").on(table.status, table.createdAt),
    index("imports_user_id_idx").on(table.userId),
    // One active import per user, enforced here because two uploads can both
    // pass the route's check before either inserts.
    uniqueIndex("imports_user_id_active_idx")
      .on(table.userId)
      .where(sql`status in ('pending', 'processing')`),
  ],
);

export type ImportInsert = typeof imports.$inferInsert;

export type Import = typeof imports.$inferSelect;

/**
 * A message for one user, shown in the app until they acknowledge it. `type`
 * selects how the app renders and acknowledges it. There is no creation route,
 * and the column defaults supply the ID and the creation time.
 */
export const notifications = sqliteTable(
  "notifications",
  {
    id: text()
      .primaryKey()
      .default(sql`(lower(hex(randomblob(16))))`),
    userId: text()
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    type: text().notNull(),
    title: text().notNull(),
    body: text().notNull(),
    createdAt: integer({ mode: "timestamp" })
      .default(sql`(unixepoch())`)
      .notNull(),
    /** Null while the notification is unacknowledged. */
    acknowledgedAt: integer({ mode: "timestamp_ms" }),
  },
  (table) => [
    index("notifications_user_id_idx").on(table.userId),
    // At most one unacknowledged Spotify reauthorization notice per user.
    uniqueIndex("notifications_spotify_reauth_unacknowledged_idx")
      .on(table.userId)
      .where(sql`type = 'spotify-reauth' and acknowledgedAt is null`),
  ],
);

export type Notification = typeof notifications.$inferSelect;

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
    imports,
    notifications,
  },
  (r) => ({
    users: {
      scrobbles: r.many.scrobbles({ from: r.users.id, to: r.scrobbles.userId }),
      sessions: r.many.sessions({ from: r.users.id, to: r.sessions.userId }),
      accounts: r.many.accounts({ from: r.users.id, to: r.accounts.userId }),
      imports: r.many.imports({ from: r.users.id, to: r.imports.userId }),
      notifications: r.many.notifications({ from: r.users.id, to: r.notifications.userId }),
    },
    sessions: {
      user: r.one.users({ from: r.sessions.userId, to: r.users.id, optional: false }),
    },
    accounts: {
      user: r.one.users({ from: r.accounts.userId, to: r.users.id, optional: false }),
    },
    notifications: {
      user: r.one.users({ from: r.notifications.userId, to: r.users.id, optional: false }),
    },
    imports: {
      user: r.one.users({ from: r.imports.userId, to: r.users.id, optional: false }),
      scrobbles: r.many.scrobbles({ from: r.imports.id, to: r.scrobbles.importId }),
    },
    scrobbles: {
      user: r.one.users({ from: r.scrobbles.userId, to: r.users.id, optional: false }),
      track: r.one.tracks({
        from: r.scrobbles.trackSpotifyUri,
        to: r.tracks.spotifyUri,
        optional: true,
      }),
      album: r.one.albums({
        from: r.scrobbles.albumSpotifyUri,
        to: r.albums.spotifyUri,
        optional: true,
      }),
      import: r.one.imports({
        from: r.scrobbles.importId,
        to: r.imports.id,
        optional: true,
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
