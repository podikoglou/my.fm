import { HttpApi } from "effect/http-api";

import { FeedGroup } from "./feed.ts";
import { HealthGroup } from "./health.ts";
import { ImportGroup } from "./import.ts";
import { NotificationsGroup } from "./notifications.ts";
import { OAuthGroup } from "./oauth.ts";
import { ScrobbleGroup } from "./scrobble.ts";
import { StatsGroup } from "./stats.ts";
import { UserGroup } from "./user.ts";

export {
  AuthRateLimitMiddleware,
  CurrentUser,
  OptionalSession,
  OptionalSessionMiddleware,
  PublicReadRateLimitMiddleware,
  RequireSessionMiddleware,
  SessionUserSchema,
  StatsRateLimitMiddleware,
  type OptionalSessionValue,
  type SessionUser,
} from "./auth.ts";

export {
  AlreadyOnboardedApiError,
  InternalServerApiError,
  InternalServerError,
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
  AcceptedImportResponse,
  ImportBadRequestApiError,
  ImportBadRequestError,
  ImportConflictApiError,
  ImportConflictError,
  ImportGroup,
  ImportPayloadTooLargeApiError,
  ImportPayloadTooLargeError,
  ImportSchema,
  ImportStatusSchema,
  ImportTooManyRequestsApiError,
  ImportTooManyRequestsError,
  ImportUnprocessableApiError,
  ImportUnprocessableError,
  LatestImportResponse,
} from "./import.ts";

export {
  AcknowledgeNotificationResponse,
  NotificationSchema,
  NotificationsGroup,
} from "./notifications.ts";

export {
  InvalidOAuthApiRequestError,
  InvalidOAuthRequestApiError,
  OAuthAppSchema,
  OAuthAppsResponse,
  OAuthAuthorizeDetailsResponse,
  OAuthClientSummarySchema,
  OAuthDecideInput,
  OAuthDecideResponse,
  OAuthGroup,
  RevokeOAuthAppResponse,
} from "./oauth.ts";

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
  StatsGroup,
  SummarySchema,
  TimelineSchema,
  TopEntitiesSchema,
  TopItemSchema,
  SampledPlaySchema,
} from "./stats.ts";

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
  .add(StatsGroup)
  .add(FeedGroup)
  .add(NotificationsGroup)
  .add(ImportGroup)
  .add(OAuthGroup) {}
