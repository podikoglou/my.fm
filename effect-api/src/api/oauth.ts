import { Schema, SchemaTransformation } from "effect";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { AuthRateLimitMiddleware, RequireSessionMiddleware } from "./auth.ts";
import { InternalServerApiError } from "./errors.ts";

export class InvalidOAuthApiRequestError extends Schema.TaggedError<InvalidOAuthApiRequestError>()(
  "InvalidOAuthApiRequestError",
  { error: Schema.Literal("Invalid OAuth request") },
) {}

export const InvalidOAuthRequestApiError = Schema.Struct({
  error: Schema.Literal("Invalid OAuth request"),
}).pipe(
  Schema.decodeTo(
    Schema.toType(InvalidOAuthApiRequestError),
    SchemaTransformation.transform({
      decode: (input) => new InvalidOAuthApiRequestError({ error: input.error }),
      encode: (err) => ({ error: err.error }),
    }),
  ),
  HttpApiSchema.status(400),
);

export const OAuthClientSummarySchema = Schema.Struct({
  clientId: Schema.String,
  clientName: Schema.optional(Schema.String),
  clientUri: Schema.optional(Schema.String),
});

export const OAuthAuthorizeDetailsResponse = Schema.Struct({
  client: OAuthClientSummarySchema,
  scope: Schema.Array(Schema.String),
  redirectUri: Schema.String,
});

export const OAuthDecideInput = Schema.Struct({
  decision: Schema.Literals(["allow", "deny"]),
  query: Schema.String,
});

export const OAuthDecideResponse = Schema.Struct({
  redirectTo: Schema.String,
});

export const OAuthAppSchema = Schema.Struct({
  id: Schema.String,
  clientId: Schema.String,
  name: Schema.String,
  clientUri: Schema.optional(Schema.String),
  scope: Schema.Array(Schema.String),
  createdAt: Schema.Number,
});

export const OAuthAppsResponse = Schema.Struct({
  apps: Schema.Array(OAuthAppSchema),
});

export const RevokeOAuthAppResponse = Schema.Struct({
  success: Schema.Literal(true),
});

const getAuthorize = HttpApiEndpoint.get("getAuthorize", "/authorize", {
  query: Schema.Record(Schema.String, Schema.String),
  success: OAuthAuthorizeDetailsResponse,
  error: [InvalidOAuthRequestApiError],
});

const decideAuthorize = HttpApiEndpoint.post("decideAuthorize", "/authorize", {
  payload: OAuthDecideInput,
  success: OAuthDecideResponse,
  error: [InvalidOAuthRequestApiError],
});

const listApps = HttpApiEndpoint.get("listApps", "/apps", {
  success: OAuthAppsResponse,
  error: [InternalServerApiError],
});

const revokeApp = HttpApiEndpoint.delete("revokeApp", "/apps/:id", {
  params: {
    id: Schema.String.check(Schema.isMinLength(1)),
  },
  success: RevokeOAuthAppResponse,
  error: [InternalServerApiError],
});

export class OAuthGroup extends HttpApiGroup.make("oauth")
  .add(getAuthorize)
  .add(decideAuthorize)
  .add(listApps)
  .add(revokeApp)
  .middleware(RequireSessionMiddleware)
  .middleware(AuthRateLimitMiddleware)
  .prefix("/api/oauth") {}
