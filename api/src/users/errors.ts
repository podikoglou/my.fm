import { Schema } from "effect";

export class UserNotFoundError extends Schema.TaggedError<UserNotFoundError>()(
  "UserNotFoundError",
  { message: Schema.String },
) {}

export class ProfilePrivateError extends Schema.TaggedError<ProfilePrivateError>()(
  "ProfilePrivateError",
  { message: Schema.String },
) {}

export class AlreadyOnboardedError extends Schema.TaggedError<AlreadyOnboardedError>()(
  "AlreadyOnboardedError",
  { message: Schema.String },
) {}
