import { Option, Schema } from "effect";

const SDK_QUOTA_ERROR_MESSAGE = "The app has exceeded its rate limits.";

/** Reason code Spotify returns when a developer-account quota bucket rejects a request. */
export const SPOTIFY_QUOTA_REASON = "QUOTA_EXCEEDED";

/** Rejection reasons Spotify reports in 429 bodies. */
export type SpotifyQuotaReason = typeof SPOTIFY_QUOTA_REASON;

/**
 * Raised when Spotify rejects a request with HTTP 429 or the SDK reports
 * app-level rate-limit exhaustion.
 *
 * Spotify's rate limit applies across the application, so ingestion stops the
 * entire run rather than retrying other accounts.
 *
 * `reason` is `"QUOTA_EXCEEDED"` when the developer-account quota rejected the
 * request and `null` when the rolling rate limit did; the two limiters have
 * different windows, so logs that keep the reason can attribute each block.
 */
export class SpotifyQuotaExceededError extends Schema.TaggedError<
  SpotifyQuotaExceededError,
  { readonly brand: unique symbol }
>()("SpotifyQuotaExceededError", {
  retryAfterSeconds: Schema.NullOr(Schema.Finite),
  reason: Schema.NullOr(Schema.Literal(SPOTIFY_QUOTA_REASON)),
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

const QuotaErrorBody = Schema.Struct({
  error: Schema.Struct({
    reason: Schema.optional(Schema.Literal(SPOTIFY_QUOTA_REASON)),
  }),
});

const decodeQuotaBody = Schema.decodeUnknownOption(QuotaErrorBody);

/**
 * Extract the rejection reason from a 429 response body.
 *
 * A missing or malformed body decodes to `null`, matching the empty body the
 * rolling rate limit returns.
 */
export async function parseQuotaReason(response: Response): Promise<SpotifyQuotaReason | null> {
  try {
    const quotaBody = decodeQuotaBody(JSON.parse(await response.text()));

    return Option.match(quotaBody, {
      onNone: () => null,
      onSome: (value) => value.error.reason ?? null,
    });
  } catch {
    return null;
  }
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
    return new SpotifyQuotaExceededError({ retryAfterSeconds: null, reason: null });
  }

  return null;
}
