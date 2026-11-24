import { Schema, SchemaTransformation } from "effect";
import { Multipart } from "effect/http";
import { HttpApiEndpoint, HttpApiGroup, HttpApiSchema } from "effect/http-api";

import { MAX_FILE_SIZE_BYTES } from "../import/csv.ts";
import { RequireSessionMiddleware } from "./auth.ts";
import { InternalServerApiError, ServiceUnavailableApiError } from "./errors.ts";

const MULTIPART_OVERHEAD_BYTES = 64 * 1024;

export const ImportUploadPayload = Schema.Struct({
  file: Multipart.SingleFileSchema,
}).pipe(
  HttpApiSchema.asMultipartStream({
    maxFileSize: MAX_FILE_SIZE_BYTES,
    maxTotalSize: MAX_FILE_SIZE_BYTES + MULTIPART_OVERHEAD_BYTES,
  }),
);

export const ImportStatusSchema = Schema.Literals(["pending", "processing", "completed", "failed"]);

export const ImportSchema = Schema.Struct({
  id: Schema.String,
  userId: Schema.String,
  filename: Schema.String,
  status: ImportStatusSchema,
  cursor: Schema.Number,
  totalLines: Schema.NullOr(Schema.Number),
  processedRows: Schema.Number,
  skippedRows: Schema.Number,
  attemptCount: Schema.Number,
  error: Schema.NullOr(Schema.String),
  createdAt: Schema.NullOr(Schema.DateFromString),
  updatedAt: Schema.DateFromString,
});

export const LatestImportResponse = Schema.Struct({
  import: Schema.NullOr(ImportSchema),
});

export const AcceptedImportResponse = Schema.Struct({
  id: Schema.String,
  filename: Schema.String,
  status: ImportStatusSchema,
  totalLines: Schema.Number,
}).pipe(HttpApiSchema.status(202));

export class ImportBadRequestError extends Schema.TaggedError<ImportBadRequestError>()(
  "ImportBadRequestError",
  { error: Schema.String },
) {}

export const ImportBadRequestApiError = Schema.Struct({ error: Schema.String }).pipe(
  Schema.decodeTo(
    Schema.toType(ImportBadRequestError),
    SchemaTransformation.transform({
      decode: (input) => new ImportBadRequestError({ error: input.error }),
      encode: (err) => ({ error: err.error }),
    }),
  ),
  HttpApiSchema.status(400),
);

export class ImportConflictError extends Schema.TaggedError<ImportConflictError>()(
  "ImportConflictError",
  { error: Schema.String },
) {}

export const ImportConflictApiError = Schema.Struct({ error: Schema.String }).pipe(
  Schema.decodeTo(
    Schema.toType(ImportConflictError),
    SchemaTransformation.transform({
      decode: (input) => new ImportConflictError({ error: input.error }),
      encode: (err) => ({ error: err.error }),
    }),
  ),
  HttpApiSchema.status(409),
);

export class ImportPayloadTooLargeError extends Schema.TaggedError<ImportPayloadTooLargeError>()(
  "ImportPayloadTooLargeError",
  { error: Schema.String },
) {}

export const ImportPayloadTooLargeApiError = Schema.Struct({ error: Schema.String }).pipe(
  Schema.decodeTo(
    Schema.toType(ImportPayloadTooLargeError),
    SchemaTransformation.transform({
      decode: (input) => new ImportPayloadTooLargeError({ error: input.error }),
      encode: (err) => ({ error: err.error }),
    }),
  ),
  HttpApiSchema.status(413),
);

export class ImportUnprocessableError extends Schema.TaggedError<ImportUnprocessableError>()(
  "ImportUnprocessableError",
  { error: Schema.String },
) {}

export const ImportUnprocessableApiError = Schema.Struct({ error: Schema.String }).pipe(
  Schema.decodeTo(
    Schema.toType(ImportUnprocessableError),
    SchemaTransformation.transform({
      decode: (input) => new ImportUnprocessableError({ error: input.error }),
      encode: (err) => ({ error: err.error }),
    }),
  ),
  HttpApiSchema.status(422),
);

export class ImportTooManyRequestsError extends Schema.TaggedError<ImportTooManyRequestsError>()(
  "ImportTooManyRequestsError",
  { error: Schema.String },
) {}

export const ImportTooManyRequestsApiError = Schema.Struct({ error: Schema.String }).pipe(
  Schema.decodeTo(
    Schema.toType(ImportTooManyRequestsError),
    SchemaTransformation.transform({
      decode: (input) => new ImportTooManyRequestsError({ error: input.error }),
      encode: (err) => ({ error: err.error }),
    }),
  ),
  HttpApiSchema.status(429),
);

export class ImportGroup extends HttpApiGroup.make("import")
  .add(
    HttpApiEndpoint.get("latest", "/import/latest", {
      success: LatestImportResponse,
      error: [ServiceUnavailableApiError, InternalServerApiError],
    }).middleware(RequireSessionMiddleware),
  )
  .add(
    HttpApiEndpoint.post("upload", "/import", {
      payload: ImportUploadPayload,
      success: AcceptedImportResponse,
      error: [
        ImportBadRequestApiError,
        ImportConflictApiError,
        ImportPayloadTooLargeApiError,
        ImportUnprocessableApiError,
        ImportTooManyRequestsApiError,
        InternalServerApiError,
        ServiceUnavailableApiError,
      ],
    }).middleware(RequireSessionMiddleware),
  )
  .prefix("/api") {}
