import type { BatchItem } from "drizzle-orm/batch";

import { and, eq, gte, isNotNull, lt, max, min, sql } from "drizzle-orm";

import type { DrizzleDatabase } from "../service.ts";

import { monthsBetween } from "../../time-zone.ts";
import { FEED_VISIBLE_USER } from "../../users/visibility.ts";
import {
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  type Album,
  type Artist,
  type Scrobble,
  type Track,
  type User,
} from "../schema.ts";

/**
 * Derive a deterministic scrobble ID from the user and the play time.
 *
 * A re-fetched play must get the same ID, so `onConflictDoNothing` can stop a
 * duplicate. The ID keeps the first 16 bytes of the SHA-256 digest as 32
 * lowercase hex characters.
 */
export async function createScrobbleId(userId: User["id"], scrobbleDate: Date) {
  const key = `${userId}:${scrobbleDate.toISOString()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));

  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type PlayArtist = Pick<Artist, "name" | "spotifyUri"> & {
  imageUrl?: Artist["imageUrl"];
};

export type PlayAlbum = Pick<
  Album,
  "name" | "spotifyUri" | "releaseDate" | "totalTracks" | "albumType" | "imageUrl"
> & {
  artists?: PlayArtist[];
};

export type PlayTrack = Pick<Track, "name" | "spotifyUri" | "releaseDate" | "imageUrl"> & {
  trackNumber?: Track["trackNumber"];
  explicit?: Track["explicit"];
  duration?: Track["duration"];
  artists?: PlayArtist[];
};

export type PlayRecord = Pick<Scrobble, "id" | "userId"> & {
  scrobbleDate?: Scrobble["scrobbleDate"];
  track?: PlayTrack | null;
  album?: PlayAlbum | null;
  artistName?: Scrobble["artistName"];
  albumName?: Scrobble["albumName"];
  trackName?: Scrobble["trackName"];
  coverArtUrl?: Scrobble["coverArtUrl"];
  normArtistKey?: Scrobble["normArtistKey"];
  normTrackKey?: Scrobble["normTrackKey"];
  importId?: Scrobble["importId"];
};

export type PersistPlaysOptions = {
  /** Maximum number of plays to bundle into a single D1 transaction batch. Default: 10 */
  batchSize?: number;
};

const DEFAULT_PLAYS_PER_BATCH = 10;

/**
 * Persist plays and their canonical catalog entities in dependency order.
 */
export async function persistPlays(
  db: DrizzleDatabase,
  plays: ReadonlyArray<PlayRecord>,
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

function buildPlayStatements(db: DrizzleDatabase, play: PlayRecord): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];

  const trackArtistsList = play.track?.artists ?? [];
  const albumArtistsList = play.album?.artists ?? [];

  const insertedUris = new Set<PlayArtist["spotifyUri"]>();

  for (const artist of [...trackArtistsList, ...albumArtistsList]) {
    if (insertedUris.has(artist.spotifyUri)) continue;

    insertedUris.add(artist.spotifyUri);
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

export type ProjectedArtist = Pick<Artist, "name"> & {
  spotifyUri?: Artist["spotifyUri"];
};

export type ProjectedTrack = Pick<Track, "name" | "imageUrl"> & {
  spotifyUri?: Track["spotifyUri"];
  artists: ProjectedArtist[];
};

export type ProjectedAlbum = Pick<Album, "name" | "imageUrl"> & {
  spotifyUri?: Album["spotifyUri"];
  artists: ProjectedArtist[];
};

export type ProjectedScrobble = Pick<Scrobble, "id" | "scrobbleDate"> & {
  track: ProjectedTrack;
  album: ProjectedAlbum;
};

export type FeedItem = Pick<Scrobble, "id"> & {
  scrobbleDate: NonNullable<Scrobble["scrobbleDate"]>;
  user: Pick<User, "username" | "name" | "avatarUrl">;
  track: ProjectedTrack;
  album: Pick<Album, "name"> & {
    spotifyUri?: Album["spotifyUri"];
  };
};

export type RecordedPlay = {
  scrobbleDate: NonNullable<Scrobble["scrobbleDate"]>;
  trackName: Track["name"];
  artistName: Artist["name"];
};

export type MonthlyScrobbleCount = {
  month: string;
  count: number;
};

function toProjectedTrack(
  row: Partial<Pick<Scrobble, "trackSpotifyUri" | "trackName" | "artistName" | "coverArtUrl">> & {
    track?:
      | (Pick<Track, "name" | "imageUrl" | "spotifyUri"> & {
          trackArtists: { position: number; artist: Pick<Artist, "name" | "spotifyUri"> }[];
        })
      | null;
  },
): ProjectedTrack {
  if (row.track) {
    return {
      name: row.track.name,
      imageUrl: row.track.imageUrl,
      spotifyUri: row.track.spotifyUri,
      artists: row.track.trackArtists
        .toSorted((a, b) => a.position - b.position)
        .map(({ artist }) => ({
          name: artist.name,
          spotifyUri: artist.spotifyUri,
        })),
    };
  }

  return {
    spotifyUri: row.trackSpotifyUri ?? undefined,
    name: row.trackName ?? "Unknown Track",
    imageUrl: row.coverArtUrl ?? "",
    artists: row.artistName ? [{ name: row.artistName, spotifyUri: undefined }] : [],
  };
}

function toProjectedAlbum(
  row: Partial<Pick<Scrobble, "albumSpotifyUri" | "albumName" | "coverArtUrl">> & {
    album?:
      | (Pick<Album, "name" | "imageUrl" | "spotifyUri"> & {
          albumArtists?: { position: number; artist: Pick<Artist, "name" | "spotifyUri"> }[];
        })
      | null;
  },
): ProjectedAlbum {
  if (row.album) {
    return {
      name: row.album.name,
      imageUrl: row.album.imageUrl,
      spotifyUri: row.album.spotifyUri,
      artists: (row.album.albumArtists ?? [])
        .toSorted((a, b) => a.position - b.position)
        .map(({ artist }) => ({
          name: artist.name,
          spotifyUri: artist.spotifyUri,
        })),
    };
  }

  return {
    spotifyUri: row.albumSpotifyUri ?? undefined,
    name: row.albumName ?? "",
    imageUrl: row.coverArtUrl ?? "",
    artists: [],
  };
}

export async function findRecordedPlaysBetween(
  db: DrizzleDatabase,
  userId: User["id"],
  from: NonNullable<Scrobble["scrobbleDate"]>,
  to: NonNullable<Scrobble["scrobbleDate"]>,
): Promise<RecordedPlay[]> {
  const rows = await db.query.scrobbles.findMany({
    where: { userId, importId: { isNull: true }, scrobbleDate: { gte: from, lte: to } },
    columns: { scrobbleDate: true },
    with: {
      track: {
        columns: { name: true },
        with: {
          trackArtists: {
            columns: { position: true },
            with: { artist: { columns: { name: true } } },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });

  return rows.flatMap((row) => {
    const [first] = (row.track?.trackArtists ?? []).toSorted((a, b) => a.position - b.position);
    const artistName = first?.artist.name;
    const trackName = row.track?.name;

    if (!row.scrobbleDate || !trackName || !artistName) {
      return [];
    }

    return [{ scrobbleDate: row.scrobbleDate, trackName, artistName }];
  });
}

/** `offset` pages backwards from the newest scrobble. */
export async function findRecentScrobblesByUserId(
  db: DrizzleDatabase,
  userId: User["id"],
  {
    before,
    offset,
    limit,
  }: { before?: NonNullable<Scrobble["scrobbleDate"]>; offset: number; limit: number },
): Promise<ProjectedScrobble[]> {
  const rows = await db.query.scrobbles.findMany({
    where: before ? { userId, scrobbleDate: { lt: before } } : { userId },
    orderBy: { scrobbleDate: "desc", id: "desc" },
    offset,
    limit,
    columns: {
      id: true,
      scrobbleDate: true,
      trackSpotifyUri: true,
      albumSpotifyUri: true,
      coverArtUrl: true,
      artistName: true,
      albumName: true,
      trackName: true,
    },
    with: {
      track: {
        columns: {
          name: true,
          imageUrl: true,
          spotifyUri: true,
        },
        with: {
          trackArtists: {
            columns: { position: true },
            with: {
              artist: {
                columns: { name: true, spotifyUri: true },
              },
            },
            orderBy: { position: "asc" },
          },
        },
      },
      album: {
        columns: {
          name: true,
          imageUrl: true,
          spotifyUri: true,
        },
        with: {
          albumArtists: {
            columns: { position: true },
            with: {
              artist: {
                columns: { name: true, spotifyUri: true },
              },
            },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });

  return rows.map((row) => ({
    id: row.id,
    scrobbleDate: row.scrobbleDate,
    track: toProjectedTrack(row),
    album: toProjectedAlbum(row),
  }));
}

export type FeedCursor = Pick<Scrobble, "id"> & {
  scrobbleDate: NonNullable<Scrobble["scrobbleDate"]>;
};

export async function findPublicFeed(
  db: DrizzleDatabase,
  { cursor, limit }: { cursor?: FeedCursor; limit: number },
): Promise<FeedItem[]> {
  const rows = await db.query.scrobbles.findMany({
    where: {
      user: FEED_VISIBLE_USER,
      scrobbleDate: { isNotNull: true as const },
      RAW: (table: typeof scrobbles) =>
        cursor
          ? sql`(${table.scrobbleDate}, ${table.id}) < (${Math.floor(
              cursor.scrobbleDate.getTime() / 1000,
            )}, ${cursor.id})`
          : sql`1 = 1`,
    },
    orderBy: { scrobbleDate: "desc", id: "desc" },
    limit,
    columns: {
      id: true,
      scrobbleDate: true,
      artistName: true,
      albumName: true,
      trackName: true,
      coverArtUrl: true,
      trackSpotifyUri: true,
      albumSpotifyUri: true,
    },
    with: {
      user: {
        columns: {
          username: true,
          name: true,
          avatarUrl: true,
        },
      },
      album: {
        columns: {
          name: true,
          spotifyUri: true,
        },
      },
      track: {
        columns: {
          name: true,
          imageUrl: true,
          spotifyUri: true,
        },
        with: {
          trackArtists: {
            columns: { position: true },
            with: {
              artist: {
                columns: { name: true, spotifyUri: true },
              },
            },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });

  return rows.flatMap((row) => {
    if (!row.scrobbleDate) return [];

    return [
      {
        id: row.id,
        scrobbleDate: row.scrobbleDate,
        user: {
          username: row.user.username,
          name: row.user.name,
          avatarUrl: row.user.avatarUrl,
        },
        track: toProjectedTrack(row),
        album: {
          name: row.album?.name ?? row.albumName ?? "",
          spotifyUri: row.album?.spotifyUri ?? row.albumSpotifyUri ?? undefined,
        },
      },
    ];
  });
}

export type ScrobbleRange = {
  /** Unix seconds, inclusive. */
  since?: number;
  /** Unix seconds, exclusive. */
  until?: number;
};

/** The first and last play time of a user's scrobbles inside `range`. */
export async function findScrobbleEdges(
  db: DrizzleDatabase,
  userId: User["id"],
  { since, until }: ScrobbleRange = {},
): Promise<{ earliest: Date; latest: Date } | null> {
  const where = and(
    eq(scrobbles.userId, userId),
    isNotNull(scrobbles.scrobbleDate),
    since === undefined ? undefined : gte(scrobbles.scrobbleDate, new Date(since * 1000)),
    until === undefined ? undefined : lt(scrobbles.scrobbleDate, new Date(until * 1000)),
  );

  // SQLite seeks the index edge only for a statement with a single min() or
  // max(). Asking for both in one select reads every scrobble in the range.
  const [[earliest], [latest]] = await db.batch([
    db
      .select({ date: min(scrobbles.scrobbleDate) })
      .from(scrobbles)
      .where(where),
    db
      .select({ date: max(scrobbles.scrobbleDate) })
      .from(scrobbles)
      .where(where),
  ]);

  if (!earliest?.date || !latest?.date) return null;

  return { earliest: earliest.date, latest: latest.date };
}

export async function countScrobblesByMonth(
  db: DrizzleDatabase,
  userId: User["id"],
  { timeZone }: { timeZone: string },
): Promise<MonthlyScrobbleCount[]> {
  const where = and(eq(scrobbles.userId, userId), isNotNull(scrobbles.scrobbleDate));

  // SQLite seeks the index edge only for a statement with a single min() or
  // max(). Asking for both in one select reads every scrobble of the user.
  const [[earliest], [latest]] = await db.batch([
    db
      .select({ date: min(scrobbles.scrobbleDate) })
      .from(scrobbles)
      .where(where),
    db
      .select({ date: max(scrobbles.scrobbleDate) })
      .from(scrobbles)
      .where(where),
  ]);

  if (!earliest?.date || !latest?.date) return [];

  const months = monthsBetween(earliest.date, latest.date, timeZone);

  const bounds = sql.join(
    months.map(({ month, start }, index) =>
      sql.raw(`('${month}', ${start}, ${months[index - 1]?.start ?? Number.MAX_SAFE_INTEGER})`),
    ),
    sql`, `,
  );

  // One index range count per month reads each scrobble once. Grouping by a
  // CASE expression reads every scrobble a second time to sort the groups.
  const counts = await db.all<MonthlyScrobbleCount>(sql`
    WITH bounds(month, since, until) AS (VALUES ${bounds})
    SELECT month, (
      SELECT count(*) FROM ${scrobbles}
      WHERE ${scrobbles.userId} = ${userId}
        AND ${scrobbles.scrobbleDate} >= bounds.since
        AND ${scrobbles.scrobbleDate} < bounds.until
    ) AS count
    FROM bounds
  `);

  return counts.filter((row) => row.count > 0);
}
