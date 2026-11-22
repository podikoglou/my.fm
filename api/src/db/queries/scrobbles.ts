import { D1Client } from "@effect/sql-d1/D1Client";
import { Effect, Option, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { DateFromEpochSeconds } from "../columns.ts";
import { asDbError } from "../service.ts";
import type { Album, Artist, Scrobble, Track, User } from "../schema.ts";
import { monthsBetween } from "../../time-zone.ts";

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

export const persistPlays = Effect.fn("scrobbles.persistPlays")(function* (
  plays: ReadonlyArray<PlayRecord>,
  options?: PersistPlaysOptions,
) {
  const sql = yield* SqlClient.SqlClient;
  const d1 = yield* D1Client;
  const batchSize = options?.batchSize ?? DEFAULT_PLAYS_PER_BATCH;

  for (let start = 0; start < plays.length; start += batchSize) {
    const chunk = plays.slice(start, start + batchSize);
    const statements = chunk.flatMap((play) => buildPlayStatements(sql, play));

    if (statements.length > 0) {
      yield* asDbError(d1.batch(statements));
    }
  }
});

function buildPlayStatements(sql: SqlClient.SqlClient, play: PlayRecord) {
  const statements = [];
  const trackArtists = play.track?.artists ?? [];
  const albumArtists = play.album?.artists ?? [];
  const insertedArtistUris = new Set<string>();

  for (const artist of [...trackArtists, ...albumArtists]) {
    if (insertedArtistUris.has(artist.spotifyUri)) continue;

    insertedArtistUris.add(artist.spotifyUri);
    statements.push(sql`
      INSERT INTO artists (spotifyUri, name, imageUrl)
      VALUES (${artist.spotifyUri}, ${artist.name}, ${artist.imageUrl ?? null})
      ON CONFLICT(spotifyUri) DO NOTHING
    `);
  }

  if (play.album) {
    statements.push(sql`
      INSERT INTO albums (spotifyUri, name, releaseDate, totalTracks, albumType, imageUrl)
      VALUES (
        ${play.album.spotifyUri},
        ${play.album.name},
        ${play.album.releaseDate},
        ${play.album.totalTracks},
        ${play.album.albumType},
        ${play.album.imageUrl}
      )
      ON CONFLICT(spotifyUri) DO NOTHING
    `);

    for (let position = 0; position < albumArtists.length; position += 1) {
      const artist = albumArtists[position];

      if (!artist) continue;

      statements.push(sql`
        INSERT INTO album_artists (album_spotify_uri, artist_spotify_uri, position)
        VALUES (${play.album.spotifyUri}, ${artist.spotifyUri}, ${position})
        ON CONFLICT(album_spotify_uri, artist_spotify_uri) DO NOTHING
      `);
    }
  }

  if (play.track) {
    statements.push(sql`
      INSERT INTO tracks (spotifyUri, name, trackNumber, releaseDate, imageUrl, explicit, duration)
      VALUES (
        ${play.track.spotifyUri},
        ${play.track.name},
        ${play.track.trackNumber ?? null},
        ${play.track.releaseDate},
        ${play.track.imageUrl},
        ${play.track.explicit === undefined ? 0 : play.track.explicit ? 1 : 0},
        ${play.track.duration ?? 0}
      )
      ON CONFLICT(spotifyUri) DO NOTHING
    `);

    for (let position = 0; position < trackArtists.length; position += 1) {
      const artist = trackArtists[position];

      if (!artist) continue;

      statements.push(sql`
        INSERT INTO track_artists (track_spotify_uri, artist_spotify_uri, position)
        VALUES (${play.track.spotifyUri}, ${artist.spotifyUri}, ${position})
        ON CONFLICT(track_spotify_uri, artist_spotify_uri) DO NOTHING
      `);
    }
  }

  statements.push(sql`
    INSERT INTO scrobbles (
      id,
      userId,
      trackSpotifyUri,
      albumSpotifyUri,
      coverArtUrl,
      artistName,
      albumName,
      trackName,
      normArtistKey,
      normTrackKey,
      scrobbleDate,
      importId
    )
    VALUES (
      ${play.id},
      ${play.userId},
      ${play.track?.spotifyUri ?? null},
      ${play.album?.spotifyUri ?? null},
      ${play.coverArtUrl ?? null},
      ${play.artistName ?? null},
      ${play.albumName ?? null},
      ${play.trackName ?? null},
      ${play.normArtistKey ?? null},
      ${play.normTrackKey ?? null},
      ${play.scrobbleDate ? Math.floor(play.scrobbleDate.getTime() / 1000) : null},
      ${play.importId ?? null}
    )
    ON CONFLICT(id) DO NOTHING
  `);

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

const RecordedPlayRow = Schema.Struct({
  scrobbleDate: Schema.NullOr(DateFromEpochSeconds),
  trackName: Schema.NullOr(Schema.String),
  artistName: Schema.NullOr(Schema.String),
});

export const findRecordedPlaysBetween = Effect.fn("scrobbles.findRecordedPlaysBetween")(function* (
  userId: User["id"],
  from: NonNullable<Scrobble["scrobbleDate"]>,
  to: NonNullable<Scrobble["scrobbleDate"]>,
) {
  const sql = yield* SqlClient.SqlClient;

  const find = SqlSchema.findAll({
    Request: Schema.Struct({
      userId: Schema.String,
      from: Schema.Int,
      to: Schema.Int,
    }),
    Result: RecordedPlayRow,
    execute: ({ userId, from, to }) => sql`
        SELECT
          s.scrobbleDate AS scrobbleDate,
          t.name AS trackName,
          (
            SELECT a.name
            FROM track_artists AS ta
            JOIN artists AS a ON a.spotifyUri = ta.artist_spotify_uri
            WHERE ta.track_spotify_uri = t.spotifyUri
            ORDER BY ta.position
            LIMIT 1
          ) AS artistName
        FROM scrobbles AS s
        LEFT JOIN tracks AS t ON t.spotifyUri = s.trackSpotifyUri
        WHERE s.userId = ${userId}
          AND s.importId IS NULL
          AND s.scrobbleDate >= ${from}
          AND s.scrobbleDate <= ${to}
      `,
  });

  const rows = yield* asDbError(
    find({
      userId,
      from: Math.floor(from.getTime() / 1000),
      to: Math.floor(to.getTime() / 1000),
    }),
  );

  return rows.flatMap((row) => {
    if (!row.scrobbleDate || !row.trackName || !row.artistName) return [];

    return [
      {
        scrobbleDate: row.scrobbleDate,
        trackName: row.trackName,
        artistName: row.artistName,
      },
    ];
  });
});

export type FeedCursor = Pick<Scrobble, "id"> & {
  scrobbleDate: NonNullable<Scrobble["scrobbleDate"]>;
};

const ScrobbleProjectionRow = Schema.Struct({
  id: Schema.String,
  scrobbleDate: Schema.NullOr(DateFromEpochSeconds),
  trackSpotifyUri: Schema.NullOr(Schema.String),
  albumSpotifyUri: Schema.NullOr(Schema.String),
  coverArtUrl: Schema.NullOr(Schema.String),
  artistName: Schema.NullOr(Schema.String),
  albumName: Schema.NullOr(Schema.String),
  trackName: Schema.NullOr(Schema.String),
  trackNameFromTrack: Schema.NullOr(Schema.String),
  trackImageUrl: Schema.NullOr(Schema.String),
  trackUriFromTrack: Schema.NullOr(Schema.String),
  albumNameFromAlbum: Schema.NullOr(Schema.String),
  albumImageUrl: Schema.NullOr(Schema.String),
  albumUriFromAlbum: Schema.NullOr(Schema.String),
  trackArtistPosition: Schema.NullOr(Schema.Int),
  trackArtistName: Schema.NullOr(Schema.String),
  trackArtistSpotifyUri: Schema.NullOr(Schema.String),
  albumArtistPosition: Schema.NullOr(Schema.Int),
  albumArtistName: Schema.NullOr(Schema.String),
  albumArtistSpotifyUri: Schema.NullOr(Schema.String),
  userUsername: Schema.NullOr(Schema.String),
  userName: Schema.NullOr(Schema.String),
  userAvatarUrl: Schema.NullOr(Schema.String),
});

type ScrobbleProjectionRow = typeof ScrobbleProjectionRow.Type;

type ScrobbleProjectionGroup = {
  row: ScrobbleProjectionRow;
  trackArtists: Array<{ position: number; name: string; spotifyUri: string }>;
  albumArtists: Array<{ position: number; name: string; spotifyUri: string }>;
};

function groupProjectionRows(rows: ReadonlyArray<ScrobbleProjectionRow>) {
  const groups = new Map<string, ScrobbleProjectionGroup>();

  for (const row of rows) {
    let group = groups.get(row.id);

    if (!group) {
      group = { row, trackArtists: [], albumArtists: [] };
      groups.set(row.id, group);
    }

    if (
      row.trackArtistPosition !== null &&
      row.trackArtistName !== null &&
      row.trackArtistSpotifyUri !== null &&
      !group.trackArtists.some(
        (artist) =>
          artist.position === row.trackArtistPosition &&
          artist.spotifyUri === row.trackArtistSpotifyUri,
      )
    ) {
      group.trackArtists.push({
        position: row.trackArtistPosition,
        name: row.trackArtistName,
        spotifyUri: row.trackArtistSpotifyUri,
      });
    }

    if (
      row.albumArtistPosition !== null &&
      row.albumArtistName !== null &&
      row.albumArtistSpotifyUri !== null &&
      !group.albumArtists.some(
        (artist) =>
          artist.position === row.albumArtistPosition &&
          artist.spotifyUri === row.albumArtistSpotifyUri,
      )
    ) {
      group.albumArtists.push({
        position: row.albumArtistPosition,
        name: row.albumArtistName,
        spotifyUri: row.albumArtistSpotifyUri,
      });
    }
  }

  return [...groups.values()];
}

function projectTrack(group: ScrobbleProjectionGroup): ProjectedTrack {
  const { row } = group;

  if (row.trackUriFromTrack !== null) {
    return {
      name: row.trackNameFromTrack ?? "",
      imageUrl: row.trackImageUrl ?? "",
      spotifyUri: row.trackUriFromTrack,
      artists: group.trackArtists
        .toSorted((a, b) => a.position - b.position)
        .map(({ name, spotifyUri }) => ({ name, spotifyUri })),
    };
  }

  return {
    spotifyUri: row.trackSpotifyUri ?? undefined,
    name: row.trackName ?? "Unknown Track",
    imageUrl: row.coverArtUrl ?? "",
    artists: row.artistName ? [{ name: row.artistName }] : [],
  };
}

function projectAlbum(group: ScrobbleProjectionGroup): ProjectedAlbum {
  const { row } = group;

  if (row.albumUriFromAlbum !== null) {
    return {
      name: row.albumNameFromAlbum ?? "",
      imageUrl: row.albumImageUrl ?? "",
      spotifyUri: row.albumUriFromAlbum,
      artists: group.albumArtists
        .toSorted((a, b) => a.position - b.position)
        .map(({ name, spotifyUri }) => ({ name, spotifyUri })),
    };
  }

  return {
    spotifyUri: row.albumSpotifyUri ?? undefined,
    name: row.albumName ?? "",
    imageUrl: row.coverArtUrl ?? "",
    artists: [],
  };
}

export const findRecentScrobblesByUserId = Effect.fn("scrobbles.findRecentByUserId")(function* (
  userId: User["id"],
  {
    before,
    offset,
    limit,
  }: { before?: NonNullable<Scrobble["scrobbleDate"]>; offset: number; limit: number },
) {
  const sql = yield* SqlClient.SqlClient;

  const beforeFilter = before
    ? sql`AND s.scrobbleDate < ${Math.floor(before.getTime() / 1000)}`
    : sql``;

  const find = SqlSchema.findAll({
    Request: Schema.Struct({
      userId: Schema.String,
      limit: Schema.Int,
      offset: Schema.Int,
    }),
    Result: ScrobbleProjectionRow,
    execute: ({ userId, limit, offset }) => sql`
        WITH page AS (
          SELECT s.id, s.scrobbleDate, s.trackSpotifyUri, s.albumSpotifyUri,
            s.coverArtUrl, s.artistName, s.albumName, s.trackName, s.userId
          FROM scrobbles AS s
          WHERE s.userId = ${userId} ${beforeFilter}
          ORDER BY s.scrobbleDate DESC, s.id DESC
          LIMIT ${limit} OFFSET ${offset}
        )
        SELECT
          s.id AS id,
          s.scrobbleDate AS scrobbleDate,
          s.trackSpotifyUri AS trackSpotifyUri,
          s.albumSpotifyUri AS albumSpotifyUri,
          s.coverArtUrl AS coverArtUrl,
          s.artistName AS artistName,
          s.albumName AS albumName,
          s.trackName AS trackName,
          t.name AS trackNameFromTrack,
          t.imageUrl AS trackImageUrl,
          t.spotifyUri AS trackUriFromTrack,
          album.name AS albumNameFromAlbum,
          album.imageUrl AS albumImageUrl,
          album.spotifyUri AS albumUriFromAlbum,
          trackArtistJoin.position AS trackArtistPosition,
          trackArtist.name AS trackArtistName,
          trackArtist.spotifyUri AS trackArtistSpotifyUri,
          albumArtistJoin.position AS albumArtistPosition,
          albumArtist.name AS albumArtistName,
          albumArtist.spotifyUri AS albumArtistSpotifyUri,
          NULL AS userUsername,
          NULL AS userName,
          NULL AS userAvatarUrl
        FROM page AS s
        LEFT JOIN tracks AS t ON t.spotifyUri = s.trackSpotifyUri
        LEFT JOIN albums AS album ON album.spotifyUri = s.albumSpotifyUri
        LEFT JOIN track_artists AS trackArtistJoin ON trackArtistJoin.track_spotify_uri = t.spotifyUri
        LEFT JOIN artists AS trackArtist ON trackArtist.spotifyUri = trackArtistJoin.artist_spotify_uri
        LEFT JOIN album_artists AS albumArtistJoin ON albumArtistJoin.album_spotify_uri = album.spotifyUri
        LEFT JOIN artists AS albumArtist ON albumArtist.spotifyUri = albumArtistJoin.artist_spotify_uri
        ORDER BY s.scrobbleDate DESC, s.id DESC,
          trackArtistJoin.position ASC, albumArtistJoin.position ASC
      `,
  });

  const rows = yield* asDbError(find({ userId, limit, offset }));
  const groups = groupProjectionRows(rows);

  return groups.map(
    (group): ProjectedScrobble => ({
      id: group.row.id,
      scrobbleDate: group.row.scrobbleDate,
      track: projectTrack(group),
      album: projectAlbum(group),
    }),
  );
});

export const findPublicFeed = Effect.fn("scrobbles.findPublicFeed")(function* ({
  cursor,
  limit,
}: {
  cursor?: FeedCursor;
  limit: number;
}) {
  const sql = yield* SqlClient.SqlClient;

  const pageFilter = cursor
    ? sql`WHERE s.scrobbleDate IS NOT NULL AND u.isPrivate = 0 AND u.onboarded = 1
        AND (s.scrobbleDate, s.id) < (${Math.floor(cursor.scrobbleDate.getTime() / 1000)}, ${cursor.id})
        ORDER BY s.scrobbleDate DESC, s.id DESC LIMIT ${limit}`
    : sql`WHERE s.scrobbleDate IS NOT NULL AND u.isPrivate = 0 AND u.onboarded = 1
        ORDER BY s.scrobbleDate DESC, s.id DESC LIMIT ${limit}`;

  const find = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ScrobbleProjectionRow,
    execute: () => sql`
      WITH page AS (
        SELECT s.id, s.scrobbleDate, s.trackSpotifyUri, s.albumSpotifyUri,
          s.coverArtUrl, s.artistName, s.albumName, s.trackName, s.userId
        FROM scrobbles AS s
        JOIN users AS u ON u.id = s.userId
        ${pageFilter}
      )
      SELECT
        s.id AS id,
        s.scrobbleDate AS scrobbleDate,
        s.trackSpotifyUri AS trackSpotifyUri,
        s.albumSpotifyUri AS albumSpotifyUri,
        s.coverArtUrl AS coverArtUrl,
        s.artistName AS artistName,
        s.albumName AS albumName,
        s.trackName AS trackName,
        t.name AS trackNameFromTrack,
        t.imageUrl AS trackImageUrl,
        t.spotifyUri AS trackUriFromTrack,
        album.name AS albumNameFromAlbum,
        album.imageUrl AS albumImageUrl,
        album.spotifyUri AS albumUriFromAlbum,
        trackArtistJoin.position AS trackArtistPosition,
        trackArtist.name AS trackArtistName,
        trackArtist.spotifyUri AS trackArtistSpotifyUri,
        albumArtistJoin.position AS albumArtistPosition,
        albumArtist.name AS albumArtistName,
        albumArtist.spotifyUri AS albumArtistSpotifyUri,
        u.username AS userUsername,
        u.name AS userName,
        u.avatarUrl AS userAvatarUrl
      FROM page AS s
      JOIN users AS u ON u.id = s.userId
      LEFT JOIN tracks AS t ON t.spotifyUri = s.trackSpotifyUri
      LEFT JOIN albums AS album ON album.spotifyUri = s.albumSpotifyUri
      LEFT JOIN track_artists AS trackArtistJoin ON trackArtistJoin.track_spotify_uri = t.spotifyUri
      LEFT JOIN artists AS trackArtist ON trackArtist.spotifyUri = trackArtistJoin.artist_spotify_uri
      LEFT JOIN album_artists AS albumArtistJoin ON albumArtistJoin.album_spotify_uri = album.spotifyUri
      LEFT JOIN artists AS albumArtist ON albumArtist.spotifyUri = albumArtistJoin.artist_spotify_uri
      ORDER BY s.scrobbleDate DESC, s.id DESC,
        trackArtistJoin.position ASC, albumArtistJoin.position ASC
    `,
  });

  const rows = yield* asDbError(find(undefined));

  return groupProjectionRows(rows).flatMap((group): FeedItem[] => {
    const row = group.row;

    if (row.scrobbleDate === null || row.userUsername === null || row.userName === null) {
      return [];
    }

    return [
      {
        id: row.id,
        scrobbleDate: row.scrobbleDate,
        user: {
          username: row.userUsername,
          name: row.userName,
          avatarUrl: row.userAvatarUrl,
        },
        track: projectTrack(group),
        album: {
          name: row.albumNameFromAlbum ?? row.albumName ?? "",
          spotifyUri: row.albumUriFromAlbum ?? row.albumSpotifyUri ?? undefined,
        },
      },
    ];
  });
});

export type ScrobbleRange = {
  /** Unix seconds, inclusive. */
  since?: number;
  /** Unix seconds, exclusive. */
  until?: number;
};

const ScrobbleEdgeRow = Schema.Struct({
  date: Schema.NullOr(DateFromEpochSeconds),
});

/** The first and last play time of a user's scrobbles inside `range`. */
export const findScrobbleEdges = Effect.fn("scrobbles.findEdges")(function* (
  userId: User["id"],
  { since, until }: ScrobbleRange = {},
) {
  const sql = yield* SqlClient.SqlClient;

  // SQLite seeks the index edge only for a statement with a single min() or
  // max(). Asking for both in one select reads every scrobble in the range.
  const earliestQuery = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: ScrobbleEdgeRow,
    execute: ({ userId }) => sql`
      SELECT MIN(scrobbleDate) AS date
      FROM scrobbles
      WHERE userId = ${userId}
        AND scrobbleDate IS NOT NULL
        AND (${since ?? null} IS NULL OR scrobbleDate >= ${since ?? 0})
        AND (${until ?? null} IS NULL OR scrobbleDate < ${until ?? 0})
    `,
  });

  const latestQuery = SqlSchema.findOneOption({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: ScrobbleEdgeRow,
    execute: ({ userId }) => sql`
      SELECT MAX(scrobbleDate) AS date
      FROM scrobbles
      WHERE userId = ${userId}
        AND scrobbleDate IS NOT NULL
        AND (${since ?? null} IS NULL OR scrobbleDate >= ${since ?? 0})
        AND (${until ?? null} IS NULL OR scrobbleDate < ${until ?? 0})
    `,
  });

  const [earliest, latest] = yield* asDbError(
    Effect.all([earliestQuery({ userId }), latestQuery({ userId })], { concurrency: "unbounded" }),
  );

  if (
    Option.isNone(earliest) ||
    Option.isNone(latest) ||
    !earliest.value.date ||
    !latest.value.date
  ) {
    return null;
  }

  return { earliest: earliest.value.date, latest: latest.value.date };
});

export const countScrobblesByMonth = Effect.fn("scrobbles.countByMonth")(function* (
  userId: User["id"],
  { timeZone }: { timeZone: string },
) {
  const sql = yield* SqlClient.SqlClient;

  const edges = yield* findScrobbleEdges(userId);

  if (!edges) return [];

  const months = monthsBetween(edges.earliest, edges.latest, timeZone);

  // D1 caps bound parameters per statement, so the bounds are inlined as
  // integers instead of bound.
  const bounds = sql.join(
    ", ",
    false,
  )(
    months.map(
      ({ month, start }, index) =>
        sql`(${sql.literal(`'${month}'`)}, ${sql.literal(String(start))}, ${sql.literal(
          String(months[index - 1]?.start ?? Number.MAX_SAFE_INTEGER),
        )})`,
    ),
  );

  // One index range count per month reads each scrobble once. Grouping by a
  // CASE expression reads every scrobble a second time to sort the groups.
  const countQuery = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: Schema.Struct({ month: Schema.String, count: Schema.Int }),
    execute: ({ userId }) => sql`
      WITH bounds(month, since, until) AS (VALUES ${bounds})
      SELECT month, (
        SELECT count(*)
        FROM scrobbles
        WHERE userId = ${userId}
          AND scrobbleDate >= bounds.since
          AND scrobbleDate < bounds.until
      ) AS count
      FROM bounds
    `,
  });

  const counts = yield* asDbError(countQuery({ userId }));

  return counts.filter((row) => row.count > 0);
});
