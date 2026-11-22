import { Context, Schema } from "effect";
import { HttpApiMiddleware } from "effect/http-api";

import { UnauthorizedApiError } from "./errors.ts";

export const SessionUserSchema = Schema.Struct({
  id: Schema.String,
  username: Schema.String,
  name: Schema.String,
  email: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
  onboarded: Schema.NullOr(Schema.Boolean),
  isPrivate: Schema.Boolean,
});

export type SessionUser = typeof SessionUserSchema.Type;

export interface OptionalSessionValue {
  readonly userId: string;
}

export class OptionalSession extends Context.Service<
  OptionalSession,
  OptionalSessionValue | null
>()("@my.fm/effect-api/api/OptionalSession") {}

export class CurrentUser extends Context.Service<CurrentUser, SessionUser>()(
  "@my.fm/effect-api/api/CurrentUser",
) {}

export class OptionalSessionMiddleware extends HttpApiMiddleware.Service<
  OptionalSessionMiddleware,
  {
    provides: OptionalSession;
    requires: never;
  }
>()("@my.fm/effect-api/api/OptionalSessionMiddleware") {}

export class RequireSessionMiddleware extends HttpApiMiddleware.Service<
  RequireSessionMiddleware,
  {
    provides: CurrentUser;
    requires: never;
  }
>()("@my.fm/effect-api/api/RequireSessionMiddleware", {
  error: UnauthorizedApiError,
}) {}

export class PublicReadRateLimitMiddleware extends HttpApiMiddleware.Service<
  PublicReadRateLimitMiddleware,
  {
    provides: never;
    requires: never;
  }
>()("@my.fm/effect-api/api/PublicReadRateLimitMiddleware") {}
