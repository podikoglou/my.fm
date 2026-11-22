import { Schema } from "effect";

export class InvalidOAuthRequestError extends Schema.TaggedError<InvalidOAuthRequestError>()(
  "InvalidOAuthRequestError",
  {
    message: Schema.String,
  },
) {}

export class OAuthProviderError extends Schema.TaggedError<OAuthProviderError>()(
  "OAuthProviderError",
  {
    operation: Schema.String,
    cause: Schema.Defect(),
  },
) {}

export type OAuthError = InvalidOAuthRequestError | OAuthProviderError;
