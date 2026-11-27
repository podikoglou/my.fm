import { Option, Schema } from "effect";

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

/**
 * Raised when a Spotify API call fails for a non-quota reason.
 *
 * `status`, `reason` and `requestId` come from Spotify's response and are null
 * when the call failed before one arrived; `cause` then holds what was thrown.
 */
export class SpotifyClientError extends Schema.TaggedError<
  SpotifyClientError,
  { readonly brand: unique symbol }
>()("SpotifyClientError", {
  status: Schema.NullOr(Schema.Int),
  /** Spotify's `error.message`, which names the failure without echoing the request. */
  reason: Schema.NullOr(Schema.String),
  requestId: Schema.NullOr(Schema.String),
  cause: Schema.Defect(),
}) {}

const SpotifyErrorBody = Schema.fromJsonString(
  Schema.Struct({ error: Schema.Struct({ message: Schema.String }) }),
);

const decodeSpotifyErrorBody = Schema.decodeUnknownOption(SpotifyErrorBody);

/** Read the status, reason and request id from a failed Spotify response. */
export async function spotifyResponseError(response: Response): Promise<SpotifyClientError> {
  const body = decodeSpotifyErrorBody(await response.text());

  return new SpotifyClientError({
    status: response.status,
    reason: Option.match(body, { onNone: () => null, onSome: ({ error }) => error.message }),
    requestId: response.headers.get("request-id"),
    cause: null,
  });
}

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
