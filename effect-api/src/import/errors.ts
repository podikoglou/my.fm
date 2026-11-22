import { Schema } from "effect";

export class GraphQLBatchError extends Schema.TaggedError<GraphQLBatchError>()(
  "GraphQLBatchError",
  {
    message: Schema.String,
  },
) {}

export class ImportInProgressError extends Schema.TaggedError<ImportInProgressError>()(
  "ImportInProgressError",
  {
    error: Schema.String,
  },
) {}

export class ImportRateLimitError extends Schema.TaggedError<ImportRateLimitError>()(
  "ImportRateLimitError",
  {
    error: Schema.String,
  },
) {}

export class ImportValidationError extends Schema.TaggedError<ImportValidationError>()(
  "ImportValidationError",
  {
    error: Schema.String,
  },
) {}
