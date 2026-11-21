import type { BatchItem } from "drizzle-orm/batch";

import type { Database } from "../index.ts";
import type { Import, Scrobble, User } from "../schema.ts";

import { albumArtists, albums, artists, scrobbles, trackArtists, tracks } from "../schema.ts";

export type PlayArtist = {
  spotifyUri: string;
  name: string;
  imageUrl?: string | null;
};

export type PlayAlbum = {
  spotifyUri: string;
  name: string;
  releaseDate: string;
  totalTracks: number;
  albumType: string;
  imageUrl: string;
  artists?: PlayArtist[];
};

export type PlayTrack = {
  spotifyUri: string;
  name: string;
  releaseDate: string;
  imageUrl: string;
  trackNumber?: number | null;
  explicit?: boolean;
  duration?: number;
  artists?: PlayArtist[];
};

export type PlayRecord = {
  id: Scrobble["id"];
  userId: User["id"];
  scrobbleDate?: Date | null;
  track?: PlayTrack | null;
  album?: PlayAlbum | null;
  artistName?: string | null;
  albumName?: string | null;
  trackName?: string | null;
  coverArtUrl?: string | null;
  normArtistKey?: string | null;
  normTrackKey?: string | null;
  importId?: Import["id"] | null;
};

export type PersistPlaysOptions = {
  /** Maximum number of plays to bundle into a single D1 transaction batch. Default: 10 */
  batchSize?: number;
};

const DEFAULT_PLAYS_PER_BATCH = 10;

/**
 * Persist plays and their canonical catalog entities in dependency order.
 *
 * Statements are grouped into bounded batches to stay under D1 transaction and
 * statement limits while ensuring idempotency with onConflictDoNothing.
 */
export async function persistPlays(
  db: Database,
  plays: PlayRecord[],
  options?: PersistPlaysOptions,
): Promise<void> {
  const batchSize = options?.batchSize ?? DEFAULT_PLAYS_PER_BATCH;

  for (let start = 0; start < plays.length; start += batchSize) {
    const chunk = plays.slice(start, start + batchSize);
    const statements: BatchItem<"sqlite">[] = [];

    for (const play of chunk) {
      statements.push(...buildPlayStatements(db, play));
    }

    const [first, ...rest] = statements;

    if (first) {
      await db.batch([first, ...rest]);
    }
  }
}

/**
 * Build D1 statements for a single play in foreign-key dependency order:
 * artists, album, album artists, track, track artists, scrobble.
 */
export function buildPlayStatements(db: Database, play: PlayRecord): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];

  const trackArtistsList = play.track?.artists ?? [];
  const albumArtistsList = play.album?.artists ?? [];

  for (const artist of trackArtistsList) {
    statements.push(
      db
        .insert(artists)
        .values({
          spotifyUri: artist.spotifyUri,
          name: artist.name,
          imageUrl: artist.imageUrl ?? null,
        })
        .onConflictDoNothing(),
    );
  }

  for (const artist of albumArtistsList) {
    statements.push(
      db
        .insert(artists)
        .values({
          spotifyUri: artist.spotifyUri,
          name: artist.name,
          imageUrl: artist.imageUrl ?? null,
        })
        .onConflictDoNothing(),
    );
  }

  if (play.album) {
    statements.push(
      db
        .insert(albums)
        .values({
          spotifyUri: play.album.spotifyUri,
          name: play.album.name,
          releaseDate: play.album.releaseDate,
          totalTracks: play.album.totalTracks,
          albumType: play.album.albumType,
          imageUrl: play.album.imageUrl,
        })
        .onConflictDoNothing(),
    );

    for (let position = 0; position < albumArtistsList.length; position++) {
      const artist = albumArtistsList[position];

      if (artist) {
        statements.push(
          db
            .insert(albumArtists)
            .values({
              albumSpotifyUri: play.album.spotifyUri,
              artistSpotifyUri: artist.spotifyUri,
              position,
            })
            .onConflictDoNothing(),
        );
      }
    }
  }

  if (play.track) {
    statements.push(
      db
        .insert(tracks)
        .values({
          spotifyUri: play.track.spotifyUri,
          name: play.track.name,
          trackNumber: play.track.trackNumber ?? null,
          releaseDate: play.track.releaseDate,
          imageUrl: play.track.imageUrl,
          explicit: play.track.explicit ?? false,
          duration: play.track.duration ?? 0,
        })
        .onConflictDoNothing(),
    );

    for (let position = 0; position < trackArtistsList.length; position++) {
      const artist = trackArtistsList[position];

      if (artist) {
        statements.push(
          db
            .insert(trackArtists)
            .values({
              trackSpotifyUri: play.track.spotifyUri,
              artistSpotifyUri: artist.spotifyUri,
              position,
            })
            .onConflictDoNothing(),
        );
      }
    }
  }

  statements.push(
    db
      .insert(scrobbles)
      .values({
        id: play.id,
        userId: play.userId,
        trackSpotifyUri: play.track?.spotifyUri ?? null,
        albumSpotifyUri: play.album?.spotifyUri ?? null,
        coverArtUrl: play.coverArtUrl ?? null,
        artistName: play.artistName ?? null,
        albumName: play.albumName ?? null,
        trackName: play.trackName ?? null,
        normArtistKey: play.normArtistKey ?? null,
        normTrackKey: play.normTrackKey ?? null,
        scrobbleDate: play.scrobbleDate ?? null,
        importId: play.importId ?? null,
      })
      .onConflictDoNothing(),
  );

  return statements;
}
