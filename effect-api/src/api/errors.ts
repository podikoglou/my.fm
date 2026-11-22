import { Schema, SchemaTransformation } from "effect";
import { HttpApiSchema } from "effect/http-api";

export const UnauthorizedApiError = Schema.Struct({
  error: Schema.Literal(""),
}).pipe(HttpApiSchema.status(401));

export const ProfilePrivateApiError = Schema.Struct({
  error: Schema.Literal("Profile is private"),
}).pipe(HttpApiSchema.status(403));

export const UserNotFoundApiError = Schema.Struct({
  error: Schema.Literal("User not found"),
}).pipe(HttpApiSchema.status(404));

export const AlreadyOnboardedApiError = Schema.Struct({
  error: Schema.Literal("Already onboarded"),
}).pipe(HttpApiSchema.status(400));

export class ServiceUnavailableError extends Schema.TaggedError<ServiceUnavailableError>()(
  "ServiceUnavailableError",
  { error: Schema.String },
) {}

export const ServiceUnavailableApiError = Schema.Struct({
  error: Schema.String,
}).pipe(
  Schema.decodeTo(
    Schema.toType(ServiceUnavailableError),
    SchemaTransformation.transform({
      decode: (input) => new ServiceUnavailableError({ error: input.error }),
      encode: (err) => ({ error: err.error }),
    }),
  ),
  HttpApiSchema.status(503),
);
