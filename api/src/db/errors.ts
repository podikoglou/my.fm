import { Schema } from "effect";

/**
 * The distinctive part of the binding's daily-limit messages. The full text
 * prefixes `D1_ERROR: ` and links the limits page, so a substring match
 * survives both.
 *
 * https://developers.cloudflare.com/d1/observability/debug-d1/#list-of-d1_errors
 */
const D1_WRITE_LIMIT_MARKER = "Your account has exceeded D1's free tier daily row write limit";
const D1_READ_LIMIT_MARKER = "Your account has exceeded D1's free tier daily row read limit";

/**
 * How many errors one cause chain may hold. Drizzle adds one wrapper around
 * the binding's error, so four covers the known shapes and stops a loop.
 */
const MAX_CAUSE_DEPTH = 4;

/** Which account-wide daily limit D1 refused. */
export const D1RowLimitSchema = Schema.Literals(["row-write", "row-read"]);

export type D1RowLimit = typeof D1RowLimitSchema.Type;

export type D1QuotaFailure = {
  limit: D1RowLimit;
};

/** A failure description that keeps the cause chain, which Workers Logs drops on an Error. */
export type ErrorDescription = {
  name: string;
  message: string;
  /** Messages of the errors below this one, outermost first. */
  causes: string[];
};

export const D1_QUOTA_ERROR_MESSAGE =
  "Service is temporarily unavailable. Please try again tomorrow.";

/** Typed Effect error raised when D1 refuses a query due to the daily free-tier quota. */
export class D1QuotaExceededError extends Schema.TaggedError<
  D1QuotaExceededError,
  { readonly brand: unique symbol }
>()("D1QuotaExceededError", {
  limit: D1RowLimitSchema,
  description: Schema.Struct({
    name: Schema.String,
    message: Schema.String,
    causes: Schema.Array(Schema.String),
  }),
}) {
  override get message(): string {
    return D1_QUOTA_ERROR_MESSAGE;
  }
}

/** Typed Effect error raised when a D1 query fails for a non-quota reason. */
export class D1QueryError extends Schema.TaggedError<
  D1QueryError,
  { readonly brand: unique symbol }
>()("D1QueryError", {
  description: Schema.Struct({
    name: Schema.String,
    message: Schema.String,
    causes: Schema.Array(Schema.String),
  }),
}) {}

export type DbError = D1QuotaExceededError | D1QueryError;

/**
 * Classify an error as D1 refusing the account's daily free-tier limit.
 *
 * Drizzle wraps a single-statement binding error in DrizzleQueryError and
 * keeps the message on the cause, while a batch error arrives unwrapped, so
 * the match walks the chain.
 */
export function getD1QuotaError(error: Error): D1QuotaFailure | null {
  let current: Error | null = error;

  for (let depth = 0; current !== null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    if (current.message.includes(D1_WRITE_LIMIT_MARKER)) {
      return { limit: "row-write" };
    }

    if (current.message.includes(D1_READ_LIMIT_MARKER)) {
      return { limit: "row-read" };
    }

    current = current.cause instanceof Error ? current.cause : null;
  }

  return null;
}

/**
 * Flatten an error and its cause chain into a plain object.
 *
 * Workers Logs drops `.cause` when an Error is a log argument, so a wrapped
 * D1 failure would show only Drizzle's `Failed query: ...` line. The causes
 * array carries the binding's message into the log instead.
 */
export function describeError(error: Error): ErrorDescription {
  const causes: string[] = [];

  let current: Error | null = error.cause instanceof Error ? error.cause : null;

  for (let depth = 1; current !== null && depth < MAX_CAUSE_DEPTH; depth += 1) {
    causes.push(current.message);
    current = current.cause instanceof Error ? current.cause : null;
  }

  return { name: error.name, message: error.message, causes };
}

/** Classify a thrown D1/Drizzle error into a typed `DbError`. */
export function classifyDbError(error: Error): DbError {
  const quota = getD1QuotaError(error);
  const description = describeError(error);

  if (quota !== null) {
    return new D1QuotaExceededError({ limit: quota.limit, description });
  }

  return new D1QueryError({ description });
}
