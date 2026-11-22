import { HttpApi } from "effect/http-api";

import { HealthGroup } from "./health.ts";
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
  ProfilePrivateApiError,
  ServiceUnavailableApiError,
  ServiceUnavailableError,
  UnauthorizedApiError,
  UserNotFoundApiError,
} from "./errors.ts";

export {
  HealthGroup,
  HealthOkResponse,
  HealthUnavailableResponse,
  INGESTION_STALE_AFTER_MS,
  IngestionHealthOkResponse,
  IngestionHealthStaleResponse,
} from "./health.ts";

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
export class MyFmApi extends HttpApi.make("my-fm").add(HealthGroup).add(UserGroup) {}
