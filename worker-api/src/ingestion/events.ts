/**
 * Event names for ingestion telemetry.
 *
 * Workers Logs stores the keys of a logged object as fields, so a normal event
 * is one object and a query matches `attributes['event']`. Workers Issues
 * groups failures by their message text, so a failure logs its stable event
 * name as the message and keeps the variable parts in the arguments.
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

/** What a failure line adds after the event name: the cause, or the subject. */
export type IngestionFailureDetail = string | Error;

export type IngestionEventFields = {
  event: IngestionEventName;
  userId?: string;
  retryAfterSeconds?: number | null;
  accounts?: number;
  plays?: number;
  failures?: number;
  status?: IngestionStatus;
};

/**
 * Log a normal event as one object.
 *
 * A message string before the object would merge into the log text and drop
 * the fields, so the object stays the only argument.
 */
export function logIngestionEvent(fields: IngestionEventFields) {
  console.log(fields);
}

/**
 * Log a failure whose event name becomes the message.
 *
 * Pass details only when they identify the cause. A value that changes between
 * otherwise identical failures, such as a retry delay, splits the Workers
 * Issues group and produces a new notification each time.
 */
export function logIngestionFailure(event: IngestionEventName, detail?: IngestionFailureDetail) {
  if (detail === undefined) {
    console.error(event);

    return;
  }

  console.error(event, detail);
}

/** Log a condition that is worth seeing but is not a failure. */
export function logIngestionWarning(event: IngestionEventName, detail?: IngestionFailureDetail) {
  if (detail === undefined) {
    console.warn(event);

    return;
  }

  console.warn(event, detail);
}
