import type { WorkerEnv } from "../alchemy.ts";
import type { GqlTrack, QueryItem } from "../import/graphql.ts";

import { describeError, getD1QuotaError } from "../db/errors.ts";
import { createDatabase } from "../db/index.ts";
import {
  findActiveImportForCron,
  updateImport,
  updateImportAtCursor,
} from "../db/queries/imports.ts";
import { getImportR2Key } from "../import/csv.ts";
import { readImportFile } from "../import/file.ts";
import { readImportedPlays, storeImportedPlays, withoutRecordedPlays } from "../import/plays.ts";
import { resolveTracksWaterfall } from "../import/resolver.ts";
import {
  INGESTION_EVENTS,
  d1QuotaEventName,
  logIngestionEvent,
  logIngestionFailure,
} from "./events.ts";

const IMPORT_LINES_PER_RUN = 500;

/**
 * Consecutive batch failures tolerated before an import is abandoned. The
 * cron trigger runs every minute, so three failures hold the queue for only
 * a few minutes before the import gives up.
 */
const IMPORT_MAX_ATTEMPTS = 3;

const IMPORT_GAVE_UP_ERROR = "Import failed after repeated metadata batch errors";

/**
 * The outcome of a run whose import moved on while it worked. A run that
 * outlasts the cron interval overlaps the next one, and both read the same
 * cursor; the plays are idempotent, so the late run only drops its
 * bookkeeping.
 */
const SUPERSEDED = { status: "superseded", processed: 0 };

export type ImportIngestionOptions = {
  batchLimit?: number;
  throttleMs?: number;
  fetchBatch?: (endpoint: string, query: string) => Promise<Record<string, GqlTrack | null>>;
};

/**
 * Process the oldest active import for one cron tick.
 *
 * A D1 daily-limit error stops the tick without touching the database
 * again: nothing can be written until midnight UTC, so the import stays
 * exactly as it was and the next tick retries. The status `paused` marks
 * that outcome; every other status is the result of real progress.
 */
export async function runImportIngestion(env: WorkerEnv, options?: ImportIngestionOptions) {
  try {
    return await processActiveImport(env, options);
  } catch (error) {
    const quota = error instanceof Error ? getD1QuotaError(error) : null;

    if (!quota) {
      throw error;
    }

    logIngestionFailure(d1QuotaEventName(quota.limit));

    return { status: "paused", processed: 0 };
  }
}

/** One cron tick of import processing, without the D1-limit envelope. */
async function processActiveImport(env: WorkerEnv, options?: ImportIngestionOptions) {
  const db = createDatabase(env.DB);
  const activeImport = await findActiveImportForCron(db);

  if (!activeImport) {
    return { status: "idle", processed: 0 };
  }

  if (activeImport.status === "pending") {
    await updateImport(db, activeImport.id, { status: "processing" });
  }

  const r2Key = getImportR2Key(activeImport.id);
  const r2Object = await env.IMPORTS_BUCKET.get(r2Key);

  if (!r2Object) {
    await updateImport(db, activeImport.id, {
      status: "failed",
      error: "File not found in storage",
    });

    return { status: "failed", processed: 0 };
  }

  const read = readImportFile(await r2Object.text());

  if (!read.ok) {
    await updateImport(db, activeImport.id, { status: "failed", error: read.error });

    await env.IMPORTS_BUCKET.delete(r2Key);

    return { status: "failed", processed: 0 };
  }

  const { lines, headers } = read.file;
  const totalLines = lines.length;

  const batchLimit = options?.batchLimit ?? IMPORT_LINES_PER_RUN;
  const startIndex = Math.max(1, activeImport.cursor === 0 ? 1 : activeImport.cursor);

  if (startIndex >= lines.length) {
    await updateImport(db, activeImport.id, {
      status: "completed",
      cursor: lines.length,
      totalLines,
    });

    await env.IMPORTS_BUCKET.delete(r2Key);

    return { status: "completed", processed: 0 };
  }

  const endIndex = Math.min(startIndex + batchLimit, lines.length);
  const batchLines = lines.slice(startIndex, endIndex);

  const plays = await withoutRecordedPlays(
    db,
    activeImport.userId,
    await readImportedPlays(activeImport.userId, batchLines, headers),
  );

  // A line that holds no play and a play that ingestion already recorded
  // both count as skipped.
  const skippedInBatch = batchLines.length - plays.length;

  const queryItems: QueryItem[] = plays.map((item) => ({
    key: item.normTrackKey,
    artist: item.row.artist,
    title: item.row.track,
    album: item.row.album,
  }));

  try {
    const resolvedMap = await resolveTracksWaterfall(queryItems, {
      throttleMs: options?.throttleMs,
      fetchBatch: options?.fetchBatch,
    });

    await storeImportedPlays(db, activeImport, plays, resolvedMap);
  } catch (error) {
    if (error instanceof Error && getD1QuotaError(error)) {
      // The envelope reports the pause once and skips every bookkeeping
      // write below: each one would fail with the same error.
      throw error;
    }

    const attemptCount = activeImport.attemptCount + 1;

    logIngestionFailure(
      INGESTION_EVENTS.importBatchFailed,
      error instanceof Error ? describeError(error) : String(error),
    );

    if (attemptCount >= IMPORT_MAX_ATTEMPTS) {
      // The cron queue always picks the oldest active import, so a failure
      // that never clears would wedge every other user's import behind it.
      // Abandon the import instead of retrying it forever.
      const abandoned = await updateImportAtCursor(db, activeImport, {
        status: "failed",
        error: IMPORT_GAVE_UP_ERROR,
        attemptCount,
      });

      if (!abandoned) {
        return SUPERSEDED;
      }

      await env.IMPORTS_BUCKET.delete(r2Key);

      logIngestionFailure(INGESTION_EVENTS.importFailed, activeImport.id);

      return { status: "failed", processed: 0 };
    }

    await updateImportAtCursor(db, activeImport, { attemptCount });

    return { status: "processing", processed: 0 };
  }

  logIngestionEvent({
    event: INGESTION_EVENTS.importIngested,
    importId: activeImport.id,
    processed: plays.length,
  });

  const newProcessed = activeImport.processedRows + plays.length;
  const newSkipped = activeImport.skippedRows + skippedInBatch;
  const isFinished = endIndex >= lines.length;

  const advanced = await updateImportAtCursor(db, activeImport, {
    cursor: endIndex,
    processedRows: newProcessed,
    skippedRows: newSkipped,
    totalLines,
    attemptCount: 0,
    status: isFinished ? "completed" : "processing",
  });

  if (!advanced) {
    return SUPERSEDED;
  }

  if (isFinished) {
    await env.IMPORTS_BUCKET.delete(r2Key);
  }

  return {
    status: isFinished ? "completed" : "processing",
    processed: plays.length,
    skipped: skippedInBatch,
  };
}
