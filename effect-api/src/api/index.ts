import { HttpApi } from "effect/http-api";

import { FeedGroup } from "./feed.ts";
import { HealthGroup } from "./health.ts";
import { NotificationsGroup } from "./notifications.ts";
import { ScrobbleGroup } from "./scrobble.ts";
import { UserGroup } from "./user.ts";

export {
  CurrentUser,
  OptionalSession,
  OptionalSessionMiddleware,
  PublicReadRateLimitMiddleware,
  RequireSessionMiddleware,
  SessionUserSchema,
  type OptionalSessionValue,
  type SessionUser,
} from "./auth.ts";

export {
  AlreadyOnboardedApiError,
  InvalidCursorApiError,
  NotificationNotFoundApiError,
  ProfilePrivateApiError,
  ServiceUnavailableApiError,
  ServiceUnavailableError,
  UnauthorizedApiError,
  UserNotFoundApiError,
} from "./errors.ts";

export { FeedCacheMiddleware, FeedGroup, FeedItemSchema, PublicFeedPageSchema } from "./feed.ts";

export {
  HealthGroup,
  HealthOkResponse,
  HealthUnavailableResponse,
  INGESTION_STALE_AFTER_MS,
  IngestionHealthOkResponse,
  IngestionHealthStaleResponse,
} from "./health.ts";

export {
  AcknowledgeNotificationResponse,
  NotificationSchema,
  NotificationsGroup,
} from "./notifications.ts";

export {
  MonthlyScrobbleCountSchema,
  ProjectedAlbumSchema,
  ProjectedArtistSchema,
  ProjectedScrobbleSchema,
  ProjectedTrackSchema,
  ScrobbleGroup,
  TimeZoneSchema,
} from "./scrobble.ts";

export {
  OnboardInput,
  OnboardResponse,
  PublicUserSchema,
  UpdateUserSettingsInput,
  UpdateUserSettingsResponse,
  UserGroup,
} from "./user.ts";

export { NameSchema, NanoidSchema, UsernameSchema } from "./validators.ts";

/**
 * Shared HTTP API contract for `my.fm`.
 *
 * Groups are added here across the migration PRs so the frontend can consume
 * one typed `HttpApiClient` without importing server implementation code.
 */
export class MyFmApi extends HttpApi.make("my-fm")
  .add(HealthGroup)
  .add(UserGroup)
  .add(ScrobbleGroup)
  .add(FeedGroup)
  .add(NotificationsGroup) {}
