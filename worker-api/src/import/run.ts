import type { WorkerEnv } from "../alchemy.ts";
import type { Database } from "../db/index.ts";
import type { Import, ImportInsert, User } from "../db/schema.ts";
import type { GqlTrack, QueryItem } from "./graphql.ts";

import { describeError, getD1QuotaError } from "../db/errors.ts";
import { createDatabase } from "../db/index.ts";
import {
  findActiveImportForCron,
  findUserActiveImport,
  findUserRecentImport,
  insertImport,
  updateImport,
  updateImportAtCursor,
} from "../db/queries/imports.ts";
import {
  INGESTION_EVENTS,
  d1QuotaEventName,
  logIngestionEvent,
  logIngestionFailure,
} from "../ingestion/events.ts";
import { getImportR2Key } from "./csv.ts";
import { hasValidRow, readImportFile } from "./file.ts";
import { readImportedPlays, storeImportedPlays, withoutRecordedPlays } from "./plays.ts";
import { resolveTracksWaterfall } from "./resolver.ts";

/**
 * The import run: the lifecycle of one CSV import, from its accepted upload
 * to its terminal status.
 *
 * An import is a row in `imports` paired with a file in R2. An active row
 * implies its file exists; a terminal row implies the file is gone. Both
 * writers — the upload route and the cron tick — cross this module, so the
 * pairing holds in one place.
 */

const IMPORT_LINES_PER_RUN = 500;

/**
 * Consecutive batch failures tolerated before an import is abandoned. The
 * cron trigger runs every minute, so three failures hold the queue for only
 * a few minutes before the import gives up.
 */
const IMPORT_MAX_ATTEMPTS = 3;

const IMPORT_GAVE_UP_ERROR = "Import failed after repeated metadata batch errors";

const DEFAULT_FILENAME = "listening-history.csv";

/** One upload per user per hour. */
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

/**
 * The outcome of a run whose import moved on while it worked. A run that
 * outlasts the cron interval overlaps the next one, and both read the same
 * cursor; the plays are idempotent, so the late run only drops its
 * bookkeeping.
 */
const SUPERSEDED: ImportTickResult = { status: "superseded", processed: 0 };

export type ImportUploadRejection =
  | { error: "An import is already in progress"; status: 409 }
  | { error: "Upload rate limit exceeded: 1 import per hour"; status: 429 };

/**
 * May `userId` start an import right now? Returns the rejection when they
 * may not: one active import per user, and one upload per hour.
 *
 * The caller checks before it reads the request body, so a rejected retry
 * never pays the multipart parse. The check races with other uploads; the
 * insert's unique index is the guard that closes the race.
 */
export async function checkImportUploadEligibility(
  db: Database,
  userId: User["id"],
): Promise<ImportUploadRejection | undefined> {
  const active = await findUserActiveImport(db, userId);

  if (active) {
    return { error: "An import is already in progress", status: 409 };
  }

  const recent = await findUserRecentImport(db, userId, new Date(Date.now() - UPLOAD_WINDOW_MS));

  if (recent) {
    return { error: "Upload rate limit exceeded: 1 import per hour", status: 429 };
  }
}

export type ImportUpload = {
  filename: string;
  /** The file contents, decoded from UTF-8 by the caller. */
  text: string;
  bytes: ArrayBuffer;
};

export type ImportUploadResult =
  | { error: "An import is already in progress"; status: 409 }
  | { error: string; status: 422 }
  | {
      data: {
        id: string;
        filename: string;
        status: Import["status"];
        totalLines: number;
      };
    };

/**
 * Record an accepted upload: validate the file, store it, and open its
 * import row.
 *
 * The file is stored before the row is inserted, so the cron can only find
 * a file that exists. The cron finds a file only through its row, so the
 * file is removed again when no row is recorded: the insert failed, or a
 * concurrent upload from the same user took the active slot first.
 */
export async function acceptImportUpload(
  bucket: R2Bucket,
  db: Database,
  userId: User["id"],
  upload: ImportUpload,
): Promise<ImportUploadResult> {
  const read = readImportFile(upload.text);

  if (!read.ok) {
    return { error: read.error, status: 422 };
  }

  if (!hasValidRow(read.file)) {
    return { error: "CSV file contains no valid rows", status: 422 };
  }

  const values: ImportInsert = {
    id: crypto.randomUUID(),
    userId,
    filename: upload.filename || DEFAULT_FILENAME,
    status: "pending",
    // 0 means unstarted; the cron reads its first batch from line 1, after
    // the header.
    cursor: 0,
    totalLines: read.file.lines.length,
    processedRows: 0,
    skippedRows: 0,
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  const r2Key = getImportR2Key(values.id);

  await bucket.put(r2Key, upload.bytes, {
    httpMetadata: { contentType: "text/csv; charset=utf-8" },
  });

  let row: Import | undefined;

  try {
    row = await insertImport(db, values);
  } catch (error) {
    await bucket.delete(r2Key);

    throw error;
  }

  if (!row) {
    await bucket.delete(r2Key);

    return { error: "An import is already in progress", status: 409 };
  }

  return {
    data: {
      id: values.id,
      filename: values.filename,
      status: values.status,
      totalLines: read.file.lines.length,
    },
  };
}

export type ImportTickOptions = {
  batchLimit?: number;
  throttleMs?: number;
  fetchBatch?: (endpoint: string, query: string) => Promise<Record<string, GqlTrack | null>>;
};

export type ImportTickResult = {
  status: "idle" | "paused" | "superseded" | "processing" | "completed" | "failed";
  processed: number;
  skipped?: number;
};

/**
 * Process the oldest active import for one cron tick.
 *
 * A D1 daily-limit error stops the tick without touching the database
 * again: nothing can be written until midnight UTC, so the import stays
 * exactly as it was and the next tick retries. The status `paused` marks
 * that outcome; every other status is the result of real progress.
 */
export async function runImportTick(
  env: WorkerEnv,
  options?: ImportTickOptions,
): Promise<ImportTickResult> {
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
async function processActiveImport(
  env: WorkerEnv,
  options?: ImportTickOptions,
): Promise<ImportTickResult> {
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
