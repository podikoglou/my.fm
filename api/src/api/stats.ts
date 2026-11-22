import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import {
  OptionalSessionMiddleware,
  PublicReadRateLimitMiddleware,
  StatsRateLimitMiddleware,
} from "./auth.ts";
import {
  ProfilePrivateApiError,
  ServiceUnavailableApiError,
  UserNotFoundApiError,
} from "./errors.ts";
import { TimeZoneSchema } from "./scrobble.ts";

/**
 * Profile statistics. Each aggregate reads a profile's history in one call,
 * so these bounds keep a request cheap whichever surface (HTTP or MCP) serves
 * it, and every route also spends the stricter `STATS_RATE_LIMIT`.
 */

export const MAX_TIMELINE_BUCKETS = 400;
export const DEFAULT_TOP_LIMIT = 10;
export const DEFAULT_SAMPLE_SIZE = 20;

export const TIMELINE_TOO_LONG =
  "The range spans more than 400 buckets; narrow since/until or use a larger bucket";

const integerBetween = (minimum: number, maximum: number) =>
  [Schema.isInt(), Schema.isBetween({ minimum, maximum })] as const;

/** Unix seconds up to the end of year 9999, so every value is a valid `Date`. */
const UNIX_SECONDS = integerBetween(0, 253_402_300_799);
const TOP_LIMIT = integerBetween(1, 50);
const SAMPLE_SIZE = integerBetween(1, 50);
const SAMPLE_SEED = integerBetween(0, 0xff_ff_ff_ff);

export const TopKindSchema = Schema.Literals(["artists", "albums", "tracks"]);

export const TimelineBucketSchema = Schema.Literals(["day", "week", "month", "year"]);

/** Inputs decoded from JSON, as MCP tool arguments arrive. */
export const StatsInputSchemas = {
  unixSeconds: Schema.Finite.check(...UNIX_SECONDS),
  topLimit: Schema.Finite.check(...TOP_LIMIT),
  sampleSize: Schema.Finite.check(...SAMPLE_SIZE),
  sampleSeed: Schema.Finite.check(...SAMPLE_SEED),
};

/** The same inputs decoded from a query string. */
const StatsQuerySchemas = {
  unixSeconds: Schema.FiniteFromString.check(...UNIX_SECONDS),
  topLimit: Schema.FiniteFromString.check(...TOP_LIMIT),
  sampleSize: Schema.FiniteFromString.check(...SAMPLE_SIZE),
  sampleSeed: Schema.FiniteFromString.check(...SAMPLE_SEED),
};

export const TopItemSchema = Schema.Struct({
  name: Schema.String,
  artist: Schema.NullOr(Schema.String),
  spotifyUri: Schema.NullOr(Schema.String),
  plays: Schema.Finite,
  share: Schema.Finite,
  firstPlayedAt: Schema.DateFromString,
  lastPlayedAt: Schema.DateFromString,
});

export const TopEntitiesSchema = Schema.Struct({
  kind: TopKindSchema,
  totalScrobbles: Schema.Finite,
  distinct: Schema.Finite,
  items: Schema.Array(TopItemSchema),
});

export const SummarySchema = Schema.Struct({
  totalScrobbles: Schema.Finite,
  firstScrobbleAt: Schema.NullOr(Schema.DateFromString),
  lastScrobbleAt: Schema.NullOr(Schema.DateFromString),
  distinct: Schema.Struct({
    artists: Schema.Finite,
    albums: Schema.Finite,
    tracks: Schema.Finite,
  }),
  topArtists: Schema.Array(TopItemSchema),
  topAlbums: Schema.Array(TopItemSchema),
  topTracks: Schema.Array(TopItemSchema),
});

export const TimelineSchema = Schema.Struct({
  bucket: TimelineBucketSchema,
  timeZone: Schema.String,
  totalScrobbles: Schema.Finite,
  activeBuckets: Schema.Finite,
  buckets: Schema.Array(Schema.Struct({ label: Schema.String, count: Schema.Finite })),
  gaps: Schema.Array(
    Schema.Struct({ from: Schema.String, to: Schema.String, buckets: Schema.Finite }),
  ),
});

export const SampledPlaySchema = Schema.Struct({
  playedAt: Schema.DateFromString,
  track: Schema.NullOr(Schema.String),
  artist: Schema.NullOr(Schema.String),
  album: Schema.NullOr(Schema.String),
  spotifyUri: Schema.NullOr(Schema.String),
});

export const TimelineTooLongApiError = Schema.Struct({
  error: Schema.Literal(TIMELINE_TOO_LONG),
}).pipe(HttpApiSchema.status(400));

const rangeQuery = {
  username: Schema.String,
  since: Schema.optionalKey(StatsQuerySchemas.unixSeconds),
  until: Schema.optionalKey(StatsQuerySchemas.unixSeconds),
};

const profileErrors = [UserNotFoundApiError, ProfilePrivateApiError, ServiceUnavailableApiError];

export class StatsGroup extends HttpApiGroup.make("stats")
  .add(
    HttpApiEndpoint.get("getSummary", "/getSummary", {
      query: rangeQuery,
      success: SummarySchema,
      error: profileErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTop", "/getTop", {
      query: {
        ...rangeQuery,
        kind: TopKindSchema,
        limit: Schema.optionalKey(StatsQuerySchemas.topLimit),
      },
      success: TopEntitiesSchema,
      error: profileErrors,
    }),
  )
  .add(
    HttpApiEndpoint.get("getTimeline", "/getTimeline", {
      query: {
        ...rangeQuery,
        bucket: TimelineBucketSchema,
        timeZone: Schema.optionalKey(TimeZoneSchema),
      },
      success: TimelineSchema,
      error: [...profileErrors, TimelineTooLongApiError],
    }),
  )
  .add(
    HttpApiEndpoint.get("getSample", "/getSample", {
      query: {
        ...rangeQuery,
        size: Schema.optionalKey(StatsQuerySchemas.sampleSize),
        seed: Schema.optionalKey(StatsQuerySchemas.sampleSeed),
      },
      success: Schema.Array(SampledPlaySchema),
      error: profileErrors,
    }),
  )
  .middleware(StatsRateLimitMiddleware)
  .middleware(PublicReadRateLimitMiddleware)
  .middleware(OptionalSessionMiddleware)
  .prefix("/api/stats") {}
