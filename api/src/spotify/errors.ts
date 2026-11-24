import { Schema } from "effect";

const SDK_QUOTA_ERROR_MESSAGE = "The app has exceeded its rate limits.";

/**
 * Raised when Spotify rejects a request with HTTP 429 or the SDK reports
 * app-level rate-limit exhaustion.
 *
 * Spotify's rate limit applies across the application, so ingestion stops the
 * entire run rather than retrying other accounts.
 */
export class SpotifyQuotaExceededError extends Schema.TaggedError<
  SpotifyQuotaExceededError,
  { readonly brand: unique symbol }
>()("SpotifyQuotaExceededError", {
  retryAfterSeconds: Schema.NullOr(Schema.Finite),
}) {}

/** Raised when a Spotify API call fails for a non-quota reason. */
export class SpotifyClientError extends Schema.TaggedError<
  SpotifyClientError,
  { readonly brand: unique symbol }
>()("SpotifyClientError", {
  cause: Schema.Defect(),
}) {}

/**
 * Parse a `Retry-After` header value in whole seconds.
 *
 * Non-numeric values (including HTTP dates, negative numbers, decimals, and
 * empty strings) return `null`.
 */
export function parseRetryAfter(header: string | null): number | null {
  if (header === null || !/^\d+$/.test(header)) {
    return null;
  }

  return Number(header);
}

/**
 * Return the `SpotifyQuotaExceededError` if `error` represents Spotify rate
 * limit exhaustion (either our tagged error or the SDK's plain Error).
 */
export function getSpotifyQuotaError(
  error: Error | SpotifyQuotaExceededError,
): SpotifyQuotaExceededError | null {
  if (error instanceof SpotifyQuotaExceededError) {
    return error;
  }

  if (error.message === SDK_QUOTA_ERROR_MESSAGE) {
    return new SpotifyQuotaExceededError({ retryAfterSeconds: null });
  }

  return null;
}
