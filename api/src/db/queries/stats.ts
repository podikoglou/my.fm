import { sql, type SQL } from "drizzle-orm";

import type { DrizzleDatabase } from "../service.ts";
import type { ScrobbleRange } from "./scrobbles.ts";

import {
  albumArtists,
  albums,
  artists,
  scrobbles,
  trackArtists,
  tracks,
  type User,
} from "../schema.ts";

export type TopKind = "artists" | "albums" | "tracks";

export type TopEntityRow = {
  kind: TopKind;
  name: string;
  /** The credited artist of an album or a track; null for an artist. */
  artist: string | null;
  spotifyUri: string | null;
  plays: number;
  /** Unix seconds. */
  firstPlayed: number;
  /** Unix seconds. */
  lastPlayed: number;
  /** Distinct entities of this kind in the range. */
  distinct: number;
};

type NullableRow<T> = { [K in keyof T]: T[K] | null };

export type RankedEntities = {
  /** Every scrobble in the range, including ones without an entity of a kind. */
  total: number;
  rows: TopEntityRow[];
};

/**
 * One kind's entities from the `plays` groups. Catalog names join after
 * grouping, so they cost one lookup per distinct entity rather than one per
 * scrobble.
 *
 * An artist is the first credited artist of the catalog track, so a feature
 * counts toward the lead artist. A play without a catalog track falls back to
 * its stored artist name.
 */
function entitiesOf(kind: TopKind): SQL {
  switch (kind) {
    case "artists":
      return sql`
        SELECT 'artists' AS kind, coalesce(${artists.spotifyUri}, plays.artistName) AS key,
          coalesce(${artists.name}, plays.artistName) AS name, NULL AS artist,
          ${artists.spotifyUri} AS spotifyUri, sum(plays.plays) AS plays,
          min(plays.firstPlayed) AS firstPlayed, max(plays.lastPlayed) AS lastPlayed
        FROM plays
        LEFT JOIN ${trackArtists} ON ${trackArtists.trackSpotifyUri} = plays.trackUri
          AND ${trackArtists.position} = 0
        LEFT JOIN ${artists} ON ${artists.spotifyUri} = ${trackArtists.artistSpotifyUri}
        GROUP BY 2 HAVING key IS NOT NULL`;
    case "albums":
      return sql`
        SELECT 'albums' AS kind, grouped.key, coalesce(${albums.name}, grouped.name) AS name,
          coalesce(${artists.name}, grouped.artistName) AS artist, grouped.albumUri AS spotifyUri,
          grouped.plays, grouped.firstPlayed, grouped.lastPlayed
        FROM (
          SELECT coalesce(albumUri,
              lower(coalesce(artistName, '')) || char(31) || lower(nullif(albumName, ''))) AS key,
            max(albumUri) AS albumUri, max(albumName) AS name, max(artistName) AS artistName,
            sum(plays) AS plays, min(firstPlayed) AS firstPlayed, max(lastPlayed) AS lastPlayed
          FROM plays GROUP BY 1 HAVING key IS NOT NULL
        ) AS grouped
        LEFT JOIN ${albums} ON ${albums.spotifyUri} = grouped.albumUri
        LEFT JOIN ${albumArtists} ON ${albumArtists.albumSpotifyUri} = grouped.albumUri
          AND ${albumArtists.position} = 0
        LEFT JOIN ${artists} ON ${artists.spotifyUri} = ${albumArtists.artistSpotifyUri}
        WHERE coalesce(${albums.name}, grouped.name) IS NOT NULL`;
    case "tracks":
      return sql`
        SELECT 'tracks' AS kind, grouped.key, coalesce(${tracks.name}, grouped.name) AS name,
          coalesce(${artists.name}, grouped.artistName) AS artist, grouped.trackUri AS spotifyUri,
          grouped.plays, grouped.firstPlayed, grouped.lastPlayed
        FROM (
          SELECT coalesce(trackUri, normTrackKey,
              lower(coalesce(artistName, '')) || char(31) || lower(trackName)) AS key,
            max(trackUri) AS trackUri, max(trackName) AS name, max(artistName) AS artistName,
            sum(plays) AS plays, min(firstPlayed) AS firstPlayed, max(lastPlayed) AS lastPlayed
          FROM plays GROUP BY 1 HAVING key IS NOT NULL
        ) AS grouped
        LEFT JOIN ${tracks} ON ${tracks.spotifyUri} = grouped.trackUri
        LEFT JOIN ${trackArtists} ON ${trackArtists.trackSpotifyUri} = grouped.trackUri
          AND ${trackArtists.position} = 0
        LEFT JOIN ${artists} ON ${artists.spotifyUri} = ${trackArtists.artistSpotifyUri}
        WHERE coalesce(${tracks.name}, grouped.name) IS NOT NULL`;
  }
}

/**
 * The most played entities of each kind in the range, most played first.
 * Every kind derives from one grouping of the range, so asking for several
 * kinds reads the user's scrobbles once.
 */
export async function findTopEntities(
  db: DrizzleDatabase,
  userId: User["id"],
  {
    kinds,
    limit,
    since,
    until,
  }: ScrobbleRange & { kinds: readonly [TopKind, ...TopKind[]]; limit: number },
): Promise<RankedEntities> {
  // The totals row joins every ranked row, and stands alone when nothing ranks,
  // so the play total survives a range without any entity of these kinds.
  const rows = await db.all<{ total: number } & NullableRow<TopEntityRow>>(sql`
    WITH plays AS MATERIALIZED (
      SELECT ${scrobbles.trackSpotifyUri} AS trackUri, ${scrobbles.albumSpotifyUri} AS albumUri,
        ${scrobbles.artistName} AS artistName, ${scrobbles.albumName} AS albumName,
        ${scrobbles.trackName} AS trackName, ${scrobbles.normTrackKey} AS normTrackKey,
        count(*) AS plays, min(${scrobbles.scrobbleDate}) AS firstPlayed,
        max(${scrobbles.scrobbleDate}) AS lastPlayed
      FROM ${scrobbles}
      WHERE ${scrobbles.userId} = ${userId}
        AND ${scrobbles.scrobbleDate} >= ${since ?? 0}
        AND ${scrobbles.scrobbleDate} < ${until ?? Number.MAX_SAFE_INTEGER}
      GROUP BY 1, 2, 3, 4, 5, 6
    ),
    entities AS (${sql.join(kinds.map(entitiesOf), sql` UNION ALL `)}),
    ranked AS (
      SELECT *,
        row_number() OVER (PARTITION BY kind ORDER BY plays DESC, lastPlayed DESC) AS rank,
        count(*) OVER (PARTITION BY kind) AS "distinct"
      FROM entities
    )
    SELECT totals.total, ranked.kind, ranked.name, ranked.artist, ranked.spotifyUri,
      ranked.plays, ranked.firstPlayed, ranked.lastPlayed, ranked."distinct"
    FROM (SELECT coalesce(sum(plays), 0) AS total FROM plays) AS totals
    LEFT JOIN ranked ON ranked.rank <= ${limit}
    ORDER BY ranked.kind, ranked.rank
  `);

  return {
    total: rows[0]?.total ?? 0,
    rows: rows.filter((row): row is { total: number } & TopEntityRow => row.kind !== null),
  };
}

/** Unix-second ranges, each `[since, until)`. */
export type CountRange = { since: number; until: number };

/**
 * The number of scrobbles in each range, in order. Each count is one range of
 * the user's play-time index, so a scrobble is read once across disjoint
 * ranges and no table row is read.
 */
export async function countScrobblesInRanges(
  db: DrizzleDatabase,
  userId: User["id"],
  ranges: ReadonlyArray<CountRange>,
): Promise<number[]> {
  if (ranges.length === 0) return [];

  // D1 caps bound parameters per statement, so the integer bounds are inlined.
  const bounds = sql.raw(
    ranges
      .map(({ since, until }, index) => `(${index}, ${Math.floor(since)}, ${Math.floor(until)})`)
      .join(", "),
  );

  const rows = await db.all<{ position: number; count: number }>(sql`
    WITH bounds(position, since, until) AS (VALUES ${bounds})
    SELECT position, (
      SELECT count(*) FROM ${scrobbles}
      WHERE ${scrobbles.userId} = ${userId}
        AND ${scrobbles.scrobbleDate} >= bounds.since
        AND ${scrobbles.scrobbleDate} < bounds.until
    ) AS count
    FROM bounds
    ORDER BY position
  `);

  return rows.map((row) => row.count);
}

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

/**
 * One scrobble per point, found with two index seeks. A point whose range has
 * no scrobble is left out.
 */
export async function findScrobblesAtPoints(
  db: DrizzleDatabase,
  userId: User["id"],
  points: ReadonlyArray<SamplePoint>,
): Promise<SampledScrobble[]> {
  if (points.length === 0) return [];

  const values = sql.raw(
    points
      .map(
        ({ since, at, until }, index) =>
          `(${index}, ${Math.floor(since)}, ${Math.floor(at)}, ${Math.floor(until)})`,
      )
      .join(", "),
  );

  return db.all<SampledScrobble>(sql`
    WITH points(position, since, at, until) AS (VALUES ${values}),
    picks AS (
      SELECT position, coalesce(
        (SELECT ${scrobbles.id} FROM ${scrobbles}
          WHERE ${scrobbles.userId} = ${userId}
            AND ${scrobbles.scrobbleDate} >= points.at AND ${scrobbles.scrobbleDate} < points.until
          ORDER BY ${scrobbles.scrobbleDate}, ${scrobbles.id} LIMIT 1),
        (SELECT ${scrobbles.id} FROM ${scrobbles}
          WHERE ${scrobbles.userId} = ${userId}
            AND ${scrobbles.scrobbleDate} >= points.since AND ${scrobbles.scrobbleDate} < points.at
          ORDER BY ${scrobbles.scrobbleDate} DESC, ${scrobbles.id} DESC LIMIT 1)
      ) AS id
      FROM points
    )
    SELECT picks.position AS position, ${scrobbles.scrobbleDate} AS scrobbleDate,
      coalesce(${tracks.name}, ${scrobbles.trackName}) AS trackName,
      coalesce(${artists.name}, ${scrobbles.artistName}) AS artistName,
      coalesce(${albums.name}, ${scrobbles.albumName}) AS albumName,
      ${scrobbles.trackSpotifyUri} AS trackSpotifyUri
    FROM picks
    JOIN ${scrobbles} ON ${scrobbles.id} = picks.id
    LEFT JOIN ${tracks} ON ${tracks.spotifyUri} = ${scrobbles.trackSpotifyUri}
    LEFT JOIN ${trackArtists} ON ${trackArtists.trackSpotifyUri} = ${scrobbles.trackSpotifyUri}
      AND ${trackArtists.position} = 0
    LEFT JOIN ${artists} ON ${artists.spotifyUri} = ${trackArtists.artistSpotifyUri}
    LEFT JOIN ${albums} ON ${albums.spotifyUri} = ${scrobbles.albumSpotifyUri}
    ORDER BY picks.position
  `);
}
