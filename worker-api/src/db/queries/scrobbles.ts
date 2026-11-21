import type { BatchItem } from "drizzle-orm/batch";

import { and, count, eq, isNotNull, max, min, sql } from "drizzle-orm";

import type { Database } from "../index.ts";

import { monthsBetween } from "../../time-zone.ts";
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
function buildPlayStatements(db: Database, play: PlayRecord): BatchItem<"sqlite">[] {
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

/**
 * The plays that ingestion recorded for a user between two times, with each
 * track's name and artists. Imported plays are left out.
 */
export async function findRecordedPlaysBetween(
  db: Database,
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
  db: Database,
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

/**
 * Read the global feed. Only public, onboarded users appear, and the cursor
 * continues after the last row of the previous page.
 *
 * The row-value comparison keeps the keyset on one index range. An `OR` of
 * two comparisons can make the planner read the index twice.
 */
export async function findPublicFeed(
  db: Database,
  { cursor, limit }: { cursor?: FeedCursor; limit: number },
): Promise<FeedItem[]> {
  const rows = await db.query.scrobbles.findMany({
    where: {
      user: { isPrivate: false, onboarded: true },
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

/**
 * Count one user's scrobbles per calendar month in the viewer's time zone,
 * newest month first. Months with no plays are left out.
 *
 * Month boundaries are local midnights computed per month, so a play just after
 * midnight on the 1st counts toward the new month in summer and winter alike.
 */
export async function countScrobblesByMonth(
  db: Database,
  userId: User["id"],
  { timeZone }: { timeZone: string },
) {
  const where = and(eq(scrobbles.userId, userId), isNotNull(scrobbles.scrobbleDate));

  const [range] = await db
    .select({ first: min(scrobbles.scrobbleDate), last: max(scrobbles.scrobbleDate) })
    .from(scrobbles)
    .where(where);

  if (!range?.first || !range.last) return [];

  const months = monthsBetween(range.first, range.last, timeZone);

  // D1 caps bound parameters at 100 per query, so the boundaries are inlined.
  // Every inlined value is an integer or a "YYYY-MM" string built from integers.
  const month = sql<string>`CASE ${sql.join(
    months.map(
      ({ month, start }) =>
        sql`WHEN ${scrobbles.scrobbleDate} >= ${sql.raw(String(start))} THEN ${sql.raw(`'${month}'`)}`,
    ),
    sql` `,
  )} END`;

  const counts = await db
    .select({ month, count: count() })
    .from(scrobbles)
    .where(where)
    // By position, so the statement holds the CASE once and stays under D1's
    // statement size limit for twice as long a history.
    .groupBy(sql`1`);

  return months.flatMap(({ month }) => counts.filter((row) => row.month === month));
}
