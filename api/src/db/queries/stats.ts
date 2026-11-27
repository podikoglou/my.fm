import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";

import { TopKindSchema } from "../../api/stats.ts";
import type { TopEntityRow, TopKind } from "../../stats/ranking.ts";
import { DateFromEpochSeconds } from "../columns.ts";
import { asDbError } from "../service.ts";
import type { User } from "../schema.ts";
import type { ScrobbleRange } from "./scrobbles.ts";

/**
 * One kind's entities from the `plays` groups. Catalog names join after
 * grouping, so they cost one lookup per distinct entity rather than one per
 * scrobble.
 *
 * An artist is the first credited artist of the catalog track, so a feature
 * counts toward the lead artist. A play without a catalog track falls back to
 * its stored artist name.
 */
function entitiesOf(sql: SqlClient.SqlClient, kind: TopKind) {
  switch (kind) {
    case "artists":
      return sql`
        SELECT 'artists' AS kind, coalesce(artists.spotifyUri, plays.artistName) AS key,
          coalesce(artists.name, plays.artistName) AS name, NULL AS artist,
          artists.spotifyUri AS spotifyUri, sum(plays.plays) AS plays,
          min(plays.firstPlayed) AS firstPlayed, max(plays.lastPlayed) AS lastPlayed
        FROM plays
        LEFT JOIN track_artists ON track_artists.track_spotify_uri = plays.trackUri
          AND track_artists.position = 0
        LEFT JOIN artists ON artists.spotifyUri = track_artists.artist_spotify_uri
        GROUP BY 2 HAVING key IS NOT NULL`;
    case "albums":
      return sql`
        SELECT 'albums' AS kind, grouped.key, coalesce(albums.name, grouped.name) AS name,
          coalesce(artists.name, grouped.artistName) AS artist, grouped.albumUri AS spotifyUri,
          grouped.plays, grouped.firstPlayed, grouped.lastPlayed
        FROM (
          SELECT coalesce(albumUri,
              lower(coalesce(artistName, '')) || char(31) || lower(nullif(albumName, ''))) AS key,
            max(albumUri) AS albumUri, max(albumName) AS name, max(artistName) AS artistName,
            sum(plays) AS plays, min(firstPlayed) AS firstPlayed, max(lastPlayed) AS lastPlayed
          FROM plays GROUP BY 1 HAVING key IS NOT NULL
        ) AS grouped
        LEFT JOIN albums ON albums.spotifyUri = grouped.albumUri
        LEFT JOIN album_artists ON album_artists.album_spotify_uri = grouped.albumUri
          AND album_artists.position = 0
        LEFT JOIN artists ON artists.spotifyUri = album_artists.artist_spotify_uri
        WHERE coalesce(albums.name, grouped.name) IS NOT NULL`;
    case "tracks":
      return sql`
        SELECT 'tracks' AS kind, grouped.key, coalesce(tracks.name, grouped.name) AS name,
          coalesce(artists.name, grouped.artistName) AS artist, grouped.trackUri AS spotifyUri,
          grouped.plays, grouped.firstPlayed, grouped.lastPlayed
        FROM (
          SELECT coalesce(trackUri, normTrackKey,
              lower(coalesce(artistName, '')) || char(31) || lower(trackName)) AS key,
            max(trackUri) AS trackUri, max(trackName) AS name, max(artistName) AS artistName,
            sum(plays) AS plays, min(firstPlayed) AS firstPlayed, max(lastPlayed) AS lastPlayed
          FROM plays GROUP BY 1 HAVING key IS NOT NULL
        ) AS grouped
        LEFT JOIN tracks ON tracks.spotifyUri = grouped.trackUri
        LEFT JOIN track_artists ON track_artists.track_spotify_uri = grouped.trackUri
          AND track_artists.position = 0
        LEFT JOIN artists ON artists.spotifyUri = track_artists.artist_spotify_uri
        WHERE coalesce(tracks.name, grouped.name) IS NOT NULL`;
  }
}

/**
 * A leaderboard iteration. The ranked columns are null only on the row that
 * carries the range's play total, which left-joins the ranking so the total
 * survives a range where nothing ranks.
 */
const TopEntitiesRow = Schema.Struct({
  total: Schema.Int,
  earliest: Schema.NullOr(Schema.Int),
  latest: Schema.NullOr(Schema.Int),
  kind: Schema.NullOr(TopKindSchema),
  name: Schema.NullOr(Schema.String),
  artist: Schema.NullOr(Schema.String),
  spotifyUri: Schema.NullOr(Schema.String),
  plays: Schema.NullOr(Schema.Int),
  firstPlayed: Schema.NullOr(Schema.Int),
  lastPlayed: Schema.NullOr(Schema.Int),
  distinct: Schema.NullOr(Schema.Int),
});

function toTopEntityRow(row: typeof TopEntitiesRow.Type): TopEntityRow | null {
  if (
    row.kind === null ||
    row.name === null ||
    row.plays === null ||
    row.firstPlayed === null ||
    row.lastPlayed === null ||
    row.distinct === null
  ) {
    return null;
  }

  return {
    kind: row.kind,
    name: row.name,
    artist: row.artist,
    spotifyUri: row.spotifyUri,
    plays: row.plays,
    firstPlayed: row.firstPlayed,
    lastPlayed: row.lastPlayed,
    distinct: row.distinct,
  };
}

/**
 * The most played entities of each kind in the range, most played first.
 * Every kind derives from one grouping of the range, so asking for several
 * kinds reads the user's scrobbles once.
 */
export const findTopEntities = Effect.fn("stats.findTopEntities")(function* (
  userId: User["id"],
  {
    kinds,
    limit,
    since,
    until,
  }: ScrobbleRange & { kinds: readonly [TopKind, ...TopKind[]]; limit: number },
) {
  const sql = yield* SqlClient.SqlClient;

  const entities = sql.join(" UNION ALL ", false)(kinds.map((kind) => entitiesOf(sql, kind)));

  // The totals row left-joins every ranked row, and stands alone when nothing
  // ranks, so the play total survives a range without any entity of these kinds.
  const query = SqlSchema.findAll({
    Request: Schema.Struct({
      userId: Schema.String,
      since: Schema.Int,
      until: Schema.Int,
      limit: Schema.Int,
    }),
    Result: TopEntitiesRow,
    execute: ({ userId, since, until, limit }) => sql`
      WITH plays AS MATERIALIZED (
        SELECT trackSpotifyUri AS trackUri, albumSpotifyUri AS albumUri,
          artistName AS artistName, albumName AS albumName,
          trackName AS trackName, normTrackKey AS normTrackKey,
          count(*) AS plays, min(scrobbleDate) AS firstPlayed,
          max(scrobbleDate) AS lastPlayed
        FROM scrobbles
        WHERE userId = ${userId}
          AND scrobbleDate >= ${since}
          AND scrobbleDate < ${until}
        GROUP BY 1, 2, 3, 4, 5, 6
      ),
      entities AS (${entities}),
      ranked AS (
        SELECT *,
          row_number() OVER (PARTITION BY kind ORDER BY plays DESC, lastPlayed DESC) AS rank,
          count(*) OVER (PARTITION BY kind) AS "distinct"
        FROM entities
      )
      SELECT totals.total, totals.earliest, totals.latest, ranked.kind, ranked.name, ranked.artist, ranked.spotifyUri,
        ranked.plays, ranked.firstPlayed, ranked.lastPlayed, ranked."distinct"
      FROM (
        SELECT coalesce(sum(plays), 0) AS total, min(firstPlayed) AS earliest, max(lastPlayed) AS latest
        FROM plays
      ) AS totals
      LEFT JOIN ranked ON ranked.rank <= ${limit}
      ORDER BY ranked.kind, ranked.rank
    `,
  });

  const rows = yield* asDbError(
    query({
      userId,
      since: since ?? 0,
      until: until ?? Number.MAX_SAFE_INTEGER,
      limit,
    }),
  );

  return {
    total: rows[0]?.total ?? 0,
    earliest: rows[0]?.earliest ?? null,
    latest: rows[0]?.latest ?? null,
    rows: rows.flatMap((row) => {
      const entity = toTopEntityRow(row);

      return entity === null ? [] : [entity];
    }),
  };
});

/** Unix-second ranges, each `[since, until)`. */
export type CountRange = { since: number; until: number };

/**
 * The number of scrobbles in each range, in order. Each count is one range of
 * the user's play-time index, so a scrobble is read once across disjoint
 * ranges and no table row is read.
 */
export const countScrobblesInRanges = Effect.fn("stats.countScrobblesInRanges")(function* (
  userId: User["id"],
  ranges: ReadonlyArray<CountRange>,
) {
  if (ranges.length === 0) return [];

  const sql = yield* SqlClient.SqlClient;

  // D1 caps bound parameters per statement, so the integer bounds are inlined.
  const bounds = sql.join(
    ", ",
    false,
  )(
    ranges.map(({ since, until }, position) =>
      sql.literal(`(${position}, ${Math.floor(since)}, ${Math.floor(until)})`),
    ),
  );

  const query = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: Schema.Struct({ position: Schema.Int, count: Schema.Int }),
    execute: ({ userId }) => sql`
      WITH bounds(position, since, until) AS (VALUES ${bounds})
      SELECT position, (
        SELECT count(*) FROM scrobbles
        WHERE scrobbles.userId = ${userId}
          AND scrobbles.scrobbleDate >= bounds.since
          AND scrobbles.scrobbleDate < bounds.until
      ) AS count
      FROM bounds
      ORDER BY position
    `,
  });

  const rows = yield* asDbError(query({ userId }));

  return rows.map((row) => row.count);
});

/** A seek target: the first play at or after `at` before `until`, else the last one from `since`. */
export type SamplePoint = { since: number; at: number; until: number };

export type SampledScrobble = {
  position: number;
  /** Unix seconds. */
  scrobbleDate: number;
  trackName: string | null;
  artistName: string | null;
  albumName: string | null;
  trackSpotifyUri: string | null;
};

const SampledScrobbleRow = Schema.Struct({
  position: Schema.Int,
  scrobbleDate: Schema.NullOr(DateFromEpochSeconds),
  trackName: Schema.NullOr(Schema.String),
  artistName: Schema.NullOr(Schema.String),
  albumName: Schema.NullOr(Schema.String),
  trackSpotifyUri: Schema.NullOr(Schema.String),
});

/**
 * One scrobble per point, found with two index seeks. A point whose range has
 * no scrobble is left out.
 */
export const findScrobblesAtPoints = Effect.fn("stats.findScrobblesAtPoints")(function* (
  userId: User["id"],
  points: ReadonlyArray<SamplePoint>,
) {
  if (points.length === 0) return [];

  const sql = yield* SqlClient.SqlClient;

  const values = sql.join(
    ", ",
    false,
  )(
    points.map(({ since, at, until }, position) =>
      sql.literal(`(${position}, ${Math.floor(since)}, ${Math.floor(at)}, ${Math.floor(until)})`),
    ),
  );

  const query = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String }),
    Result: SampledScrobbleRow,
    execute: ({ userId }) => sql`
      WITH points(position, since, at, until) AS (VALUES ${values}),
      picks AS (
        SELECT position, coalesce(
          (SELECT scrobbles.id FROM scrobbles
            WHERE scrobbles.userId = ${userId}
              AND scrobbles.scrobbleDate >= points.at AND scrobbles.scrobbleDate < points.until
            ORDER BY scrobbles.scrobbleDate, scrobbles.id LIMIT 1),
          (SELECT scrobbles.id FROM scrobbles
            WHERE scrobbles.userId = ${userId}
              AND scrobbles.scrobbleDate >= points.since AND scrobbles.scrobbleDate < points.at
            ORDER BY scrobbles.scrobbleDate DESC, scrobbles.id DESC LIMIT 1)
        ) AS id
        FROM points
      )
      SELECT picks.position AS position, scrobbles.scrobbleDate AS scrobbleDate,
        coalesce(tracks.name, scrobbles.trackName) AS trackName,
        coalesce(artists.name, scrobbles.artistName) AS artistName,
        coalesce(albums.name, scrobbles.albumName) AS albumName,
        scrobbles.trackSpotifyUri AS trackSpotifyUri
      FROM picks
      JOIN scrobbles ON scrobbles.id = picks.id
      LEFT JOIN tracks ON tracks.spotifyUri = scrobbles.trackSpotifyUri
      LEFT JOIN track_artists ON track_artists.track_spotify_uri = scrobbles.trackSpotifyUri
        AND track_artists.position = 0
      LEFT JOIN artists ON artists.spotifyUri = track_artists.artist_spotify_uri
      LEFT JOIN albums ON albums.spotifyUri = scrobbles.albumSpotifyUri
      ORDER BY picks.position
    `,
  });

  const rows = yield* asDbError(query({ userId }));

  return rows.flatMap((row): SampledScrobble[] => {
    if (row.scrobbleDate === null) return [];

    return [
      {
        position: row.position,
        scrobbleDate: Math.floor(row.scrobbleDate.getTime() / 1000),
        trackName: row.trackName,
        artistName: row.artistName,
        albumName: row.albumName,
        trackSpotifyUri: row.trackSpotifyUri,
      },
    ];
  });
});
