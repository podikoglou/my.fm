import { Schema } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import {
  OptionalSessionMiddleware,
  PublicReadRateLimitMiddleware,
  RequireSessionMiddleware,
  SessionUserSchema,
} from "./auth.ts";
import {
  AlreadyOnboardedApiError,
  ProfilePrivateApiError,
  ServiceUnavailableApiError,
  UserNotFoundApiError,
} from "./errors.ts";
import { NameSchema, NanoidSchema, UsernameSchema } from "./validators.ts";

export const PublicUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  name: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});

export const UpdateUserSettingsInput = Schema.Struct({
  isPrivate: Schema.Boolean,
});

export const UpdateUserSettingsResponse = Schema.Struct({
  isPrivate: Schema.Boolean,
});

export const OnboardInput = Schema.Struct({
  username: UsernameSchema,
  name: NameSchema,
});

export const OnboardResponse = Schema.Struct({
  ok: Schema.Literal(true),
});

export class UserGroup extends HttpApiGroup.make("user")
  .add(
    HttpApiEndpoint.get("me", "/me", {
      success: SessionUserSchema,
      error: [ServiceUnavailableApiError],
    }).middleware(RequireSessionMiddleware),
  )
  .add(
    HttpApiEndpoint.get("byUsername", "/byUsername", {
      query: { username: Schema.String },
      success: PublicUserSchema,
      error: [UserNotFoundApiError, ProfilePrivateApiError, ServiceUnavailableApiError],
    })
      .middleware(PublicReadRateLimitMiddleware)
      .middleware(OptionalSessionMiddleware),
  )
  .add(
    HttpApiEndpoint.get("byId", "/byId", {
      query: { id: NanoidSchema },
      success: PublicUserSchema,
      error: [UserNotFoundApiError, ProfilePrivateApiError, ServiceUnavailableApiError],
    })
      .middleware(PublicReadRateLimitMiddleware)
      .middleware(OptionalSessionMiddleware),
  )
  .add(
    HttpApiEndpoint.patch("updateSettings", "/settings", {
      payload: UpdateUserSettingsInput,
      success: UpdateUserSettingsResponse,
      error: [ServiceUnavailableApiError],
    }).middleware(RequireSessionMiddleware),
  )
  .add(
    HttpApiEndpoint.put("onboard", "/onboard", {
      payload: [OnboardInput.pipe(HttpApiSchema.asFormUrlEncoded()), OnboardInput],
      success: OnboardResponse,
      error: [AlreadyOnboardedApiError, UserNotFoundApiError, ServiceUnavailableApiError],
    }).middleware(RequireSessionMiddleware),
  )
  .prefix("/api/user") {}
