import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiMiddleware } from "effect/http-api";

import { PublicReadRateLimitMiddleware } from "./auth.ts";
import { InvalidCursorApiError, ServiceUnavailableApiError } from "./errors.ts";
import { ProjectedTrackSchema } from "./scrobble.ts";

export const FeedUserSchema = Schema.Struct({
  username: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});

export const FeedAlbumSchema = Schema.Struct({
  name: Schema.String,
  spotifyUri: Schema.optional(Schema.String),
});

export const FeedItemSchema = Schema.Struct({
  id: Schema.String,
  scrobbleDate: Schema.DateFromString,
  user: FeedUserSchema,
  track: ProjectedTrackSchema,
  album: FeedAlbumSchema,
});

export const PublicFeedPageSchema = Schema.Struct({
  items: Schema.Array(FeedItemSchema),
  nextCursor: Schema.NullOr(Schema.String),
});

export class FeedCacheMiddleware extends HttpApiMiddleware.Service<
  FeedCacheMiddleware,
  {
    provides: never;
    requires: never;
  }
>()("@my.fm/effect-api/api/FeedCacheMiddleware") {}

export class FeedGroup extends HttpApiGroup.make("feed")
  .add(
    HttpApiEndpoint.get("getFeed", "/feed", {
      query: {
        cursor: Schema.optionalKey(Schema.String),
        limit: Schema.optionalKey(
          Schema.FiniteFromString.check(
            Schema.isInt(),
            Schema.isGreaterThanOrEqualTo(1),
            Schema.isLessThanOrEqualTo(50),
          ),
        ),
      },
      success: PublicFeedPageSchema,
      error: [InvalidCursorApiError, ServiceUnavailableApiError],
    })
      .middleware(PublicReadRateLimitMiddleware)
      .middleware(FeedCacheMiddleware),
  )
  .prefix("/api") {}
