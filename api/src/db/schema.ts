import { Schema } from "effect";

import { BooleanFromInt, DateFromEpochMillis, DateFromEpochSeconds } from "./columns.ts";

export const UserRow = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  name: Schema.String,
  email: Schema.String,
  email_verified: BooleanFromInt,
  createdAt: Schema.NullOr(DateFromEpochSeconds),
  updated_at: DateFromEpochMillis,
  avatarUrl: Schema.NullOr(Schema.String),
  lastRecentTracksFetchTime: Schema.NullOr(DateFromEpochSeconds),
  lastFetchedAt: Schema.NullOr(DateFromEpochMillis),
  lastActiveAt: Schema.NullOr(DateFromEpochMillis),
  onboarded: Schema.NullOr(BooleanFromInt),
  isPrivate: BooleanFromInt,
});

export type UserRow = typeof UserRow.Type;

export type User = Omit<UserRow, "email_verified" | "updated_at"> & {
  readonly emailVerified: UserRow["email_verified"];
  readonly updatedAt: UserRow["updated_at"];
};

export type UserInsert = Partial<User> & Pick<User, "id" | "username" | "name" | "email">;

export const IngestionRunRow = Schema.Struct({
  id: Schema.Int,
  lastRunAt: DateFromEpochMillis,
  status: Schema.String,
  blockedUntil: Schema.NullOr(DateFromEpochMillis),
});

export type IngestionRun = typeof IngestionRunRow.Type;

export const SessionRow = Schema.Struct({
  id: Schema.String,
  expires_at: DateFromEpochMillis,
  token: Schema.String,
  created_at: DateFromEpochMillis,
  updated_at: DateFromEpochMillis,
  ip_address: Schema.NullOr(Schema.String),
  user_agent: Schema.NullOr(Schema.String),
  user_id: Schema.String,
});

export type Session = {
  readonly id: string;
  readonly expiresAt: Date;
  readonly token: string;
  readonly createdAt: Date;
  readonly updatedAt: Date;
  readonly ipAddress: string | null;
  readonly userAgent: string | null;
  readonly userId: string;
};

export const AccountRow = Schema.Struct({
  id: Schema.String,
  account_id: Schema.String,
  provider_id: Schema.String,
  user_id: Schema.String,
  access_token: Schema.NullOr(Schema.String),
  refresh_token: Schema.NullOr(Schema.String),
  id_token: Schema.NullOr(Schema.String),
  access_token_expires_at: Schema.NullOr(DateFromEpochMillis),
  refresh_token_expires_at: Schema.NullOr(DateFromEpochMillis),
  scope: Schema.NullOr(Schema.String),
  password: Schema.NullOr(Schema.String),
  created_at: DateFromEpochMillis,
  updated_at: DateFromEpochMillis,
});

export type Account = {
  readonly id: string;
  readonly accountId: string;
  readonly providerId: string;
  readonly userId: string;
  readonly accessToken: string | null;
  readonly refreshToken: string | null;
  readonly idToken: string | null;
  readonly accessTokenExpiresAt: Date | null;
  readonly refreshTokenExpiresAt: Date | null;
  readonly scope: string | null;
  readonly password: string | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
};

export const VerificationRow = Schema.Struct({
  id: Schema.String,
  identifier: Schema.String,
  value: Schema.String,
  expires_at: DateFromEpochMillis,
  created_at: DateFromEpochMillis,
  updated_at: DateFromEpochMillis,
});

export const ScrobbleRow = Schema.Struct({
  id: Schema.String,
  createdAt: Schema.NullOr(DateFromEpochSeconds),
  userId: Schema.String,
  trackSpotifyUri: Schema.NullOr(Schema.String),
  albumSpotifyUri: Schema.NullOr(Schema.String),
  coverArtUrl: Schema.NullOr(Schema.String),
  artistName: Schema.NullOr(Schema.String),
  albumName: Schema.NullOr(Schema.String),
  trackName: Schema.NullOr(Schema.String),
  normArtistKey: Schema.NullOr(Schema.String),
  normTrackKey: Schema.NullOr(Schema.String),
  scrobbleDate: Schema.NullOr(DateFromEpochSeconds),
  importId: Schema.NullOr(Schema.String),
});

export type Scrobble = typeof ScrobbleRow.Type;

export type ScrobbleInsert = Partial<Scrobble> & Pick<Scrobble, "id" | "userId">;

export const ImportRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  filename: Schema.String,
  status: Schema.Literals(["pending", "processing", "completed", "failed"]),
  cursor: Schema.Int,
  totalLines: Schema.NullOr(Schema.Int),
  processedRows: Schema.Int,
  skippedRows: Schema.Int,
  attemptCount: Schema.Int,
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(DateFromEpochSeconds),
  updatedAt: DateFromEpochMillis,
});

export type Import = typeof ImportRow.Type;

export type ImportInsert = Partial<Import> & Pick<Import, "id" | "userId" | "filename" | "status">;

export const NotificationRow = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  type: Schema.String,
  title: Schema.String,
  body: Schema.String,
  createdAt: DateFromEpochSeconds,
  acknowledgedAt: Schema.NullOr(DateFromEpochMillis),
});

export type Notification = typeof NotificationRow.Type;

export const AlbumRow = Schema.Struct({
  spotifyUri: Schema.String,
  createdAt: Schema.NullOr(DateFromEpochSeconds),
  name: Schema.String,
  releaseDate: Schema.String,
  totalTracks: Schema.Int,
  albumType: Schema.String,
  imageUrl: Schema.String,
});

export type Album = typeof AlbumRow.Type;

export type AlbumInsert = Partial<Album> &
  Pick<Album, "spotifyUri" | "name" | "releaseDate" | "totalTracks" | "albumType" | "imageUrl">;

export const ArtistRow = Schema.Struct({
  spotifyUri: Schema.String,
  createdAt: Schema.NullOr(DateFromEpochSeconds),
  name: Schema.String,
  imageUrl: Schema.NullOr(Schema.String),
});

export type Artist = typeof ArtistRow.Type;

export type ArtistInsert = Partial<Artist> & Pick<Artist, "spotifyUri" | "name">;

export const TrackArtistRow = Schema.Struct({
  track_spotify_uri: Schema.String,
  artist_spotify_uri: Schema.String,
  position: Schema.Int,
});

export const AlbumArtistRow = Schema.Struct({
  album_spotify_uri: Schema.String,
  artist_spotify_uri: Schema.String,
  position: Schema.Int,
});

export const TrackRow = Schema.Struct({
  spotifyUri: Schema.String,
  createdAt: Schema.NullOr(DateFromEpochSeconds),
  name: Schema.String,
  trackNumber: Schema.NullOr(Schema.Int),
  releaseDate: Schema.String,
  imageUrl: Schema.String,
  explicit: Schema.NullOr(BooleanFromInt),
  duration: Schema.NullOr(Schema.Int),
});

export type Track = typeof TrackRow.Type;

export type TrackInsert = Partial<Track> &
  Pick<Track, "spotifyUri" | "name" | "releaseDate" | "imageUrl">;
