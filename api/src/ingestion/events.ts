import { Effect } from "effect";

import type { IngestionStatus } from "../db/queries/ingestionRuns.ts";
import {
  D1QueryError,
  D1QuotaExceededError,
  describeError,
  type ErrorDescription,
} from "../db/errors.ts";
import { SpotifyClientError } from "../spotify/errors.ts";

/**
 * Stable event names for ingestion log entries.
 *
 * Workers Issues groups failures by the message string, so failure logs keep
 * the event name as their first argument and pass variable details after it.
 */
export const INGESTION_EVENTS = {
  accountIngested: "ingestion account ingested",
  quotaExhausted: "ingestion quota exhausted",
  accountFailed: "ingestion account failed",
  tokenMissing: "ingestion token missing",
  userMissing: "ingestion user missing",
  runComplete: "ingestion run complete",
  runSkipped: "ingestion run skipped",
  importIngested: "ingestion import ingested",
  importBatchFailed: "ingestion import batch failed",
  importFailed: "ingestion import failed",
  d1WriteLimit: "ingestion d1 write limit reached",
  d1ReadLimit: "ingestion d1 read limit reached",
} as const;

export type IngestionEventFields =
  | {
      readonly event: typeof INGESTION_EVENTS.accountIngested;
      readonly userId: string;
      readonly plays: number;
    }
  | {
      readonly event: typeof INGESTION_EVENTS.runComplete;
      readonly status: IngestionStatus;
      readonly accounts: number;
      readonly fetched: number;
      readonly skipped: number;
      readonly plays: number;
      readonly failures: number;
      readonly retryAfterSeconds?: number | null;
    }
  | {
      readonly event: typeof INGESTION_EVENTS.runSkipped;
      readonly blockedUntil: string;
    }
  | {
      readonly event: typeof INGESTION_EVENTS.importIngested;
      readonly importId: string;
      readonly plays: number;
    };

export function logIngestionEvent(fields: IngestionEventFields): Effect.Effect<void> {
  return Effect.sync(() => {
    console.log(fields);
  });
}

export type IngestionFailureDetail = string | number | Error;

type FailureDescription =
  | ErrorDescription
  | (ErrorDescription & Pick<SpotifyClientError, "status" | "reason" | "requestId">);

/**
 * Workers Logs serialises an Error argument to its stack and drops its fields
 * and cause, so a failure is logged as a plain object. Only names, messages
 * and Spotify's response metadata are copied, never request data such as
 * tokens.
 */
function describeFailure(error: Error): FailureDescription {
  if (error instanceof D1QueryError || error instanceof D1QuotaExceededError) {
    return { ...error.description, causes: [...error.description.causes] };
  }

  const description = describeError(error);

  if (error instanceof SpotifyClientError) {
    return {
      ...description,
      status: error.status,
      reason: error.reason,
      requestId: error.requestId,
    };
  }

  return description;
}

function toLogArgument(detail: IngestionFailureDetail): string | number | FailureDescription {
  return detail instanceof Error ? describeFailure(detail) : detail;
}

export function logIngestionFailure(
  event:
    | typeof INGESTION_EVENTS.accountFailed
    | typeof INGESTION_EVENTS.quotaExhausted
    | typeof INGESTION_EVENTS.tokenMissing
    | typeof INGESTION_EVENTS.userMissing
    | typeof INGESTION_EVENTS.importBatchFailed
    | typeof INGESTION_EVENTS.importFailed
    | typeof INGESTION_EVENTS.d1WriteLimit
    | typeof INGESTION_EVENTS.d1ReadLimit,
  ...details: ReadonlyArray<IngestionFailureDetail>
): Effect.Effect<void> {
  return Effect.sync(() => {
    const args = details.map(toLogArgument);

    if (
      event === INGESTION_EVENTS.quotaExhausted ||
      event === INGESTION_EVENTS.userMissing ||
      event === INGESTION_EVENTS.d1WriteLimit ||
      event === INGESTION_EVENTS.d1ReadLimit
    ) {
      console.warn(event, ...args);

      return;
    }

    console.error(event, ...args);
  });
}
