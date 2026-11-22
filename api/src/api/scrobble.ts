import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup } from "effect/http-api";

import { isTimeZone } from "../time-zone.ts";
import { OptionalSessionMiddleware, PublicReadRateLimitMiddleware } from "./auth.ts";
import {
  ProfilePrivateApiError,
  ServiceUnavailableApiError,
  UserNotFoundApiError,
} from "./errors.ts";

export const ProjectedArtistSchema = Schema.Struct({
  name: Schema.String,
  spotifyUri: Schema.optional(Schema.String),
});

export const ProjectedAlbumSchema = Schema.Struct({
  name: Schema.String,
  imageUrl: Schema.String,
  spotifyUri: Schema.optional(Schema.String),
  artists: Schema.Array(ProjectedArtistSchema),
});

export const ProjectedTrackSchema = Schema.Struct({
  name: Schema.String,
  imageUrl: Schema.String,
  spotifyUri: Schema.optional(Schema.String),
  artists: Schema.Array(ProjectedArtistSchema),
});

export const ProjectedScrobbleSchema = Schema.Struct({
  id: Schema.String,
  scrobbleDate: Schema.NullOr(Schema.DateFromString),
  track: ProjectedTrackSchema,
  album: ProjectedAlbumSchema,
});

export const MonthlyScrobbleCountSchema = Schema.Struct({
  month: Schema.String,
  count: Schema.Number,
});

export const TimeZoneSchema = Schema.String.check(
  Schema.makeFilter(isTimeZone, { message: "Unknown time zone" }),
);

export class ScrobbleGroup extends HttpApiGroup.make("scrobble")
  .add(
    HttpApiEndpoint.get("getRecent", "/getRecent", {
      query: {
        username: Schema.String.check(Schema.isMinLength(1)),
        offset: Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        limit: Schema.optionalKey(
          Schema.FiniteFromString.check(
            Schema.isInt(),
            Schema.isGreaterThanOrEqualTo(1),
            Schema.isLessThanOrEqualTo(8),
          ),
        ),
        before: Schema.optionalKey(
          Schema.FiniteFromString.check(Schema.isInt(), Schema.isGreaterThanOrEqualTo(0)),
        ),
      },
      success: Schema.Array(ProjectedScrobbleSchema),
      error: [UserNotFoundApiError, ProfilePrivateApiError, ServiceUnavailableApiError],
    })
      .middleware(PublicReadRateLimitMiddleware)
      .middleware(OptionalSessionMiddleware),
  )
  .add(
    HttpApiEndpoint.get("getMonths", "/getMonths", {
      query: {
        username: Schema.String.check(Schema.isMinLength(1)),
        timeZone: Schema.optionalKey(TimeZoneSchema),
      },
      success: Schema.Array(MonthlyScrobbleCountSchema),
      error: [UserNotFoundApiError, ProfilePrivateApiError, ServiceUnavailableApiError],
    })
      .middleware(PublicReadRateLimitMiddleware)
      .middleware(OptionalSessionMiddleware),
  )
  .prefix("/api/scrobble") {}
