import { Context, Effect, Layer } from "effect";
import { SqlClient } from "effect/sql";
import type { SqlClient as SqlClientService } from "effect/sql/SqlClient";

import type { DbError } from "../db/errors.ts";
import type { User } from "../db/schema.ts";
import type { ProfilePrivateError, UserNotFoundError } from "../users/errors.ts";

import { MAX_TIMELINE_BUCKETS, TIMELINE_TOO_LONG, type ChartRange } from "../api/stats.ts";
import { findScrobbleEdges, type ScrobbleRange } from "../db/queries/scrobbles.ts";
import { countScrobblesInRanges, findScrobblesAtPoints } from "../db/queries/stats.ts";
import { calendarBuckets, type CalendarUnit } from "../time-zone.ts";
import { Users } from "../users/service.ts";
import { TimelineTooLongError } from "./errors.ts";
import { chartKinds, loadChart } from "./charts.ts";
import type { RankedEntities, TopKind } from "./ranking.ts";
import { stratifiedPoints } from "./sample.ts";
import { findGaps, type TimelineBucket, type TimelineGap } from "./timeline.ts";

const SUMMARY_TOP_LIMIT = 5;
const TIMELINE_GAP_LIMIT = 5;

export type StatsRangeInput = ScrobbleRange & { readonly username?: string };

type ChartInput = ChartRange & { readonly username?: string };

export type TopInput = ChartInput & { readonly kind: TopKind; readonly limit: number };

export type TimelineInput = StatsRangeInput & {
  readonly bucket: CalendarUnit;
  readonly timeZone: string;
};

export type SampleInput = StatsRangeInput & { readonly size: number; readonly seed: number };

export type TopItem = {
  readonly name: string;
  /** The credited artist of an album or a track; null for an artist. */
  readonly artist: string | null;
  readonly spotifyUri: string | null;
  readonly plays: number;
  /** Fraction of every scrobble in the range. */
  readonly share: number;
  readonly firstPlayedAt: Date;
  readonly lastPlayedAt: Date;
};

export type TopEntities = {
  readonly kind: TopKind;
  readonly totalScrobbles: number;
  readonly distinct: number;
  readonly items: TopItem[];
};

export type Summary = {
  readonly totalScrobbles: number;
  readonly firstScrobbleAt: Date | null;
  readonly lastScrobbleAt: Date | null;
  readonly distinct: { readonly artists: number; readonly albums: number; readonly tracks: number };
  readonly topArtists: TopItem[];
  readonly topAlbums: TopItem[];
  readonly topTracks: TopItem[];
};

export type Timeline = {
  readonly bucket: CalendarUnit;
  readonly timeZone: string;
  readonly totalScrobbles: number;
  readonly activeBuckets: number;
  readonly buckets: TimelineBucket[];
  readonly gaps: TimelineGap[];
};

export type SampledPlay = {
  readonly playedAt: Date;
  readonly track: string | null;
  readonly artist: string | null;
  readonly album: string | null;
  readonly spotifyUri: string | null;
};

type ProfileError = UserNotFoundError | ProfilePrivateError | DbError;

export interface StatsApi {
  readonly getSummary: (
    input: ChartInput,
    viewerId?: User["id"],
  ) => Effect.Effect<Summary, ProfileError>;
  readonly getTop: (
    input: TopInput,
    viewerId?: User["id"],
  ) => Effect.Effect<TopEntities, ProfileError>;
  readonly getTimeline: (
    input: TimelineInput,
    viewerId?: User["id"],
  ) => Effect.Effect<Timeline, ProfileError | TimelineTooLongError>;
  readonly getSample: (
    input: SampleInput,
    viewerId?: User["id"],
  ) => Effect.Effect<SampledPlay[], ProfileError>;
}

function toTopEntities(
  kind: TopKind,
  { total: totalScrobbles, rows: allRows }: RankedEntities,
  limit: number,
): TopEntities {
  const rows = allRows.filter((row) => row.kind === kind).slice(0, limit);

  return {
    kind,
    totalScrobbles,
    distinct: rows[0]?.distinct ?? 0,
    items: rows.map((row) => ({
      name: row.name,
      artist: row.artist,
      spotifyUri: row.spotifyUri,
      plays: row.plays,
      share: Math.round((row.plays / totalScrobbles) * 10_000) / 10_000,
      firstPlayedAt: new Date(row.firstPlayed * 1000),
      lastPlayedAt: new Date(row.lastPlayed * 1000),
    })),
  };
}

function toRange({ since, until }: ScrobbleRange): ScrobbleRange {
  return { since, until };
}

const toSeconds = (date: Date) => Math.floor(date.getTime() / 1000);

export class Stats extends Context.Service<Stats, StatsApi>()("@my.fm/api/stats/Stats") {
  static readonly layer: Layer.Layer<Stats, never, Users | SqlClientService> = Layer.effect(
    Stats,
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      const users = yield* Users;

      const runDb = <A, E>(effect: Effect.Effect<A, E, SqlClientService>) =>
        effect.pipe(Effect.provideService(SqlClient.SqlClient, sql));

      const getSummary = Effect.fn("Stats.getSummary")(function* (
        input: ChartInput,
        viewerId?: User["id"],
      ) {
        const profile = yield* users.viewListeningProfile(input.username, viewerId);
        const top = yield* runDb(loadChart(profile.id, input, chartKinds, SUMMARY_TOP_LIMIT));
        const artists = toTopEntities("artists", top, SUMMARY_TOP_LIMIT);
        const albums = toTopEntities("albums", top, SUMMARY_TOP_LIMIT);
        const tracks = toTopEntities("tracks", top, SUMMARY_TOP_LIMIT);

        return {
          totalScrobbles: tracks.totalScrobbles,
          firstScrobbleAt: top.earliest === null ? null : new Date(top.earliest * 1000),
          lastScrobbleAt: top.latest === null ? null : new Date(top.latest * 1000),
          distinct: { artists: artists.distinct, albums: albums.distinct, tracks: tracks.distinct },
          topArtists: artists.items,
          topAlbums: albums.items,
          topTracks: tracks.items,
        };
      });

      const getTop = Effect.fn("Stats.getTop")(function* (input: TopInput, viewerId?: User["id"]) {
        const profile = yield* users.viewListeningProfile(input.username, viewerId);

        const rows = yield* runDb(loadChart(profile.id, input, [input.kind], input.limit));

        return toTopEntities(input.kind, rows, input.limit);
      });

      const getTimeline = Effect.fn("Stats.getTimeline")(function* (
        input: TimelineInput,
        viewerId?: User["id"],
      ) {
        const profile = yield* users.viewListeningProfile(input.username, viewerId);
        const range = toRange(input);
        const edges = yield* runDb(findScrobbleEdges(profile.id, range));
        const empty = { bucket: input.bucket, timeZone: input.timeZone };

        if (!edges) {
          return { ...empty, totalScrobbles: 0, activeBuckets: 0, buckets: [], gaps: [] };
        }

        const calendar = calendarBuckets(
          edges.earliest,
          edges.latest,
          input.bucket,
          input.timeZone,
          MAX_TIMELINE_BUCKETS + 1,
        );

        if (calendar.length > MAX_TIMELINE_BUCKETS) {
          return yield* new TimelineTooLongError({ message: TIMELINE_TOO_LONG });
        }

        const counts = yield* runDb(
          countScrobblesInRanges(
            profile.id,
            calendar.map(({ start, end }) => ({
              since: Math.max(start, range.since ?? start),
              until: Math.min(end, range.until ?? end),
            })),
          ),
        );

        const buckets = calendar.map(({ label }, index) => ({ label, count: counts[index] ?? 0 }));

        return {
          ...empty,
          totalScrobbles: buckets.reduce((sum, { count }) => sum + count, 0),
          activeBuckets: buckets.filter(({ count }) => count > 0).length,
          buckets,
          gaps: findGaps(buckets, TIMELINE_GAP_LIMIT),
        };
      });

      const getSample = Effect.fn("Stats.getSample")(function* (
        input: SampleInput,
        viewerId?: User["id"],
      ) {
        const profile = yield* users.viewListeningProfile(input.username, viewerId);

        const edges = yield* runDb(findScrobbleEdges(profile.id, toRange(input)));

        if (!edges) return [];

        const points = stratifiedPoints(
          toSeconds(edges.earliest),
          toSeconds(edges.latest) + 1,
          input.size,
          input.seed,
        );

        const rows = yield* runDb(findScrobblesAtPoints(profile.id, points));

        return rows.map((row) => ({
          playedAt: new Date(row.scrobbleDate * 1000),
          track: row.trackName,
          artist: row.artistName,
          album: row.albumName,
          spotifyUri: row.trackSpotifyUri,
        }));
      });

      return Stats.of({ getSummary, getTop, getTimeline, getSample });
    }),
  );
}
