/**
 * Event names for ingestion telemetry.
 *
 * Each event is logged as one object, so Workers Logs indexes `event` as a
 * field that queries and alerts can match. Keep a name stable and free of
 * variable text: IDs, counts, and error details belong in the fields.
 */
export const INGESTION_EVENTS = {
  /** One account fetched and stored without error. */
  accountIngested: "ingestion_account_ingested",
  /** The run stopped because Spotify rejected the request with HTTP 429. */
  quotaExhausted: "ingestion_quota_exhausted",
  /** One account failed for a reason other than the application quota. */
  accountFailed: "ingestion_account_failed",
  /** The account has no access token, so Spotify was not called. */
  tokenMissing: "ingestion_token_missing",
  /** The account row exists but its user no longer does. */
  userMissing: "ingestion_user_missing",
  /** The run reached the end of the account list. Logged once per run. */
  runComplete: "ingestion_run_complete",
} as const;

export type IngestionEventName = (typeof INGESTION_EVENTS)[keyof typeof INGESTION_EVENTS];

/** How the run ended. `quota` means Spotify blocked the whole application. */
export type IngestionStatus = "ok" | "partial" | "quota";

export type IngestionEventFields = {
  event: IngestionEventName;
  userId?: string;
  retryAfterSeconds?: number | null;
  errorName?: string;
  errorMessage?: string;
  accounts?: number;
  plays?: number;
  failures?: number;
  status?: IngestionStatus;
};

/**
 * Log one event as a single object argument.
 *
 * Workers Logs indexes the keys of an object argument. A message string before
 * the object is merged into the log text, and the field is lost.
 */
export function logIngestionEvent(level: "info" | "warn" | "error", fields: IngestionEventFields) {
  if (level === "error") {
    console.error(fields);

    return;
  }

  if (level === "warn") {
    console.warn(fields);

    return;
  }

  console.log(fields);
}
