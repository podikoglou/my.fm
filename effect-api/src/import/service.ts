import { Clock, Context, Effect, Layer, Result } from "effect";

import type { DbError } from "../db/errors.ts";
import type { Import, User } from "../db/schema.ts";
import type { ImportsStorageError } from "../storage/service.ts";
import type { ResolveOptions } from "./graphql.ts";

import {
  findActiveImportForCron,
  findLatestImportByUserId,
  findUserActiveImport,
  findUserRecentImport,
  insertImport,
  updateImport,
  updateImportAtCursor,
} from "../db/queries/imports.ts";
import { Db } from "../db/service.ts";
import { INGESTION_EVENTS, logIngestionEvent, logIngestionFailure } from "../ingestion/events.ts";
import { ImportsStorage } from "../storage/service.ts";
import { getImportR2Key } from "./csv.ts";
import { ImportInProgressError, ImportRateLimitError, ImportValidationError } from "./errors.ts";
import { hasValidRow, readImportFile } from "./file.ts";
import { resolveTracksWaterfallEffect } from "./graphql.ts";
import { readImportedPlays, storeImportedPlays, withoutRecordedPlays } from "./plays.ts";

const IMPORT_LINES_PER_RUN = 500;
const IMPORT_MAX_ATTEMPTS = 3;
const IMPORT_GAVE_UP_ERROR = "Import failed after repeated metadata batch errors";
const DEFAULT_FILENAME = "listening-history.csv";
const UPLOAD_WINDOW_MS = 60 * 60 * 1000;

export type ImportUpload = {
  readonly filename: string;
  readonly text: string;
  readonly bytes: ArrayBuffer;
};

export type AcceptedImport = {
  readonly id: string;
  readonly filename: string;
  readonly status: Import["status"];
  readonly totalLines: number;
};

export type ImportTickOptions = ResolveOptions & {
  readonly batchLimit?: number;
};

export type ImportTickResult = {
  readonly status: "idle" | "paused" | "superseded" | "processing" | "completed" | "failed";
  readonly processed: number;
  readonly skipped?: number;
};

const SUPERSEDED: ImportTickResult = { status: "superseded", processed: 0 };

function d1LimitEvent(limit: "row-write" | "row-read") {
  return limit === "row-write" ? INGESTION_EVENTS.d1WriteLimit : INGESTION_EVENTS.d1ReadLimit;
}

export class Imports extends Context.Service<
  Imports,
  {
    readonly latestForUser: (userId: User["id"]) => Effect.Effect<Import | undefined, DbError>;
    readonly checkUploadEligibility: (
      userId: User["id"],
    ) => Effect.Effect<void, ImportInProgressError | ImportRateLimitError | DbError>;
    readonly acceptUpload: (
      userId: User["id"],
      upload: ImportUpload,
    ) => Effect.Effect<
      AcceptedImport,
      ImportInProgressError | ImportValidationError | DbError | ImportsStorageError
    >;
    readonly runTick: (options?: ImportTickOptions) => Effect.Effect<ImportTickResult>;
  }
>()("@my.fm/effect-api/import/Imports") {
  static readonly layer: Layer.Layer<Imports, never, Db | ImportsStorage> = Layer.effect(
    Imports,
    Effect.gen(function* () {
      const db = yield* Db;
      const storage = yield* ImportsStorage;

      const latestForUser = Effect.fn("Imports.latestForUser")(function* (userId: User["id"]) {
        return yield* db.query((client) => findLatestImportByUserId(client, userId));
      });

      const checkUploadEligibility = Effect.fn("Imports.checkUploadEligibility")(function* (
        userId: User["id"],
      ): Effect.fn.Return<void, ImportInProgressError | ImportRateLimitError | DbError> {
        const activeImport = yield* db.query((client) => findUserActiveImport(client, userId));

        if (activeImport) {
          return yield* new ImportInProgressError({
            error: "An import is already in progress",
          });
        }

        const nowMs = yield* Clock.currentTimeMillis;

        const recentImport = yield* db.query((client) =>
          findUserRecentImport(client, userId, new Date(nowMs - UPLOAD_WINDOW_MS)),
        );

        if (recentImport) {
          return yield* new ImportRateLimitError({
            error: "Upload rate limit exceeded: 1 import per hour",
          });
        }
      });

      const acceptUpload = Effect.fn("Imports.acceptUpload")(function* (
        userId: User["id"],
        upload: ImportUpload,
      ): Effect.fn.Return<
        AcceptedImport,
        ImportInProgressError | ImportValidationError | DbError | ImportsStorageError
      > {
        const parsed = readImportFile(upload.text);

        if (!parsed.ok) {
          return yield* new ImportValidationError({ error: parsed.error });
        }

        if (!hasValidRow(parsed.file)) {
          return yield* new ImportValidationError({
            error: "CSV file contains no valid rows",
          });
        }

        const importId = crypto.randomUUID();
        const r2Key = getImportR2Key(importId);
        const filename = upload.filename || DEFAULT_FILENAME;
        const totalLines = parsed.file.lines.length;

        yield* storage.put(r2Key, upload.bytes, {
          httpMetadata: { contentType: "text/csv; charset=utf-8" },
        });

        const deleteUploaded = storage.delete(r2Key).pipe(Effect.ignore);

        const inserted = yield* db
          .query((client) =>
            insertImport(client, {
              id: importId,
              userId,
              filename,
              status: "pending",
              totalLines,
              cursor: 0,
              processedRows: 0,
              skippedRows: 0,
            }),
          )
          .pipe(Effect.tapError(() => deleteUploaded));

        if (!inserted) {
          yield* deleteUploaded;

          return yield* new ImportInProgressError({
            error: "An import is already in progress",
          });
        }

        return {
          id: inserted.id,
          filename: inserted.filename,
          status: inserted.status,
          totalLines: inserted.totalLines ?? totalLines,
        };
      });

      const runTick = Effect.fn("Imports.runTick")(function* (
        options?: ImportTickOptions,
      ): Effect.fn.Return<ImportTickResult> {
        const tickEffect = Effect.gen(function* () {
          const activeImport = yield* db.query((client) => findActiveImportForCron(client));

          if (!activeImport) {
            return { status: "idle" as const, processed: 0 };
          }

          if (activeImport.status === "pending") {
            const nowMs = yield* Clock.currentTimeMillis;

            yield* db.query((client) =>
              updateImport(client, activeImport.id, {
                status: "processing",
                updatedAt: new Date(nowMs),
              }),
            );
          }

          const r2Key = getImportR2Key(activeImport.id);
          const object = yield* storage.get(r2Key);

          if (!object) {
            const nowMs = yield* Clock.currentTimeMillis;

            yield* db.query((client) =>
              updateImport(client, activeImport.id, {
                status: "failed",
                error: "File not found in storage",
                updatedAt: new Date(nowMs),
              }),
            );

            return { status: "failed" as const, processed: 0 };
          }

          const content = yield* Effect.promise(() => object.text());
          const parsed = readImportFile(content);

          if (!parsed.ok) {
            const nowMs = yield* Clock.currentTimeMillis;

            yield* db.query((client) =>
              updateImport(client, activeImport.id, {
                status: "failed",
                error: parsed.error,
                updatedAt: new Date(nowMs),
              }),
            );

            yield* storage.delete(r2Key).pipe(Effect.ignore);

            return { status: "failed" as const, processed: 0 };
          }

          const { lines, headers } = parsed.file;
          const totalLines = lines.length;
          const batchLimit = options?.batchLimit ?? IMPORT_LINES_PER_RUN;
          const startIndex = Math.max(1, activeImport.cursor === 0 ? 1 : activeImport.cursor);

          if (startIndex >= lines.length) {
            const nowMs = yield* Clock.currentTimeMillis;

            yield* db.query((client) =>
              updateImport(client, activeImport.id, {
                status: "completed",
                cursor: lines.length,
                totalLines,
                updatedAt: new Date(nowMs),
              }),
            );

            yield* storage.delete(r2Key).pipe(Effect.ignore);

            return { status: "completed" as const, processed: 0 };
          }

          const endIndex = Math.min(startIndex + batchLimit, lines.length);
          const batchLines = lines.slice(startIndex, endIndex);

          const plays = yield* Effect.promise(() =>
            readImportedPlays(activeImport.userId, batchLines, headers),
          );

          const newPlays = yield* withoutRecordedPlays(activeImport.userId, plays);
          const batchSkipped = batchLines.length - newPlays.length;

          const queryItems = newPlays.map(({ row, normTrackKey }) => ({
            key: normTrackKey,
            artist: row.artist,
            title: row.track,
            album: row.album,
          }));

          const resolveResult = yield* Effect.result(
            resolveTracksWaterfallEffect(queryItems, options),
          );

          if (Result.isFailure(resolveResult)) {
            const err = resolveResult.failure;
            const attempts = activeImport.attemptCount + 1;
            const gaveUp = attempts >= IMPORT_MAX_ATTEMPTS;
            const nowMs = yield* Clock.currentTimeMillis;

            yield* logIngestionFailure(INGESTION_EVENTS.importBatchFailed, err.message);

            if (gaveUp) {
              const abandoned = yield* db.query((client) =>
                updateImportAtCursor(client, activeImport, {
                  status: "failed",
                  attemptCount: attempts,
                  error: IMPORT_GAVE_UP_ERROR,
                  updatedAt: new Date(nowMs),
                }),
              );

              if (!abandoned) {
                return SUPERSEDED;
              }

              yield* storage.delete(r2Key).pipe(Effect.ignore);
              yield* logIngestionFailure(INGESTION_EVENTS.importFailed, activeImport.id);

              return { status: "failed" as const, processed: 0 };
            }

            const recorded = yield* db.query((client) =>
              updateImportAtCursor(client, activeImport, {
                attemptCount: attempts,
                updatedAt: new Date(nowMs),
              }),
            );

            if (!recorded) {
              return SUPERSEDED;
            }

            return { status: "processing" as const, processed: 0 };
          }

          const resolved = resolveResult.success;

          yield* storeImportedPlays(activeImport, newPlays, resolved);

          const isComplete = endIndex >= lines.length;
          const newProcessedRows = activeImport.processedRows + newPlays.length;
          const newSkippedRows = activeImport.skippedRows + batchSkipped;
          const nowMs = yield* Clock.currentTimeMillis;

          const applied = yield* db.query((client) =>
            updateImportAtCursor(client, activeImport, {
              cursor: endIndex,
              totalLines,
              processedRows: newProcessedRows,
              skippedRows: newSkippedRows,
              attemptCount: 0,
              status: isComplete ? "completed" : "processing",
              updatedAt: new Date(nowMs),
            }),
          );

          if (!applied) {
            return SUPERSEDED;
          }

          if (isComplete) {
            yield* storage.delete(r2Key).pipe(Effect.ignore);
          }

          yield* logIngestionEvent({
            event: INGESTION_EVENTS.importIngested,
            importId: activeImport.id,
            plays: newPlays.length,
          });

          return {
            status: isComplete ? ("completed" as const) : ("processing" as const),
            processed: newPlays.length,
            skipped: batchSkipped,
          };
        });

        return yield* tickEffect.pipe(
          Effect.provideService(Db, db),
          Effect.catchTag("D1QuotaExceededError", (quotaErr) =>
            Effect.gen(function* () {
              yield* logIngestionFailure(d1LimitEvent(quotaErr.limit));

              return { status: "paused" as const, processed: 0 };
            }),
          ),
          Effect.catchTag("D1QueryError", (queryErr) =>
            Effect.gen(function* () {
              yield* logIngestionFailure(INGESTION_EVENTS.importBatchFailed, queryErr.message);

              return { status: "processing" as const, processed: 0 };
            }),
          ),
          Effect.catchTag("ImportsStorageError", (storageErr) =>
            Effect.gen(function* () {
              yield* logIngestionFailure(
                INGESTION_EVENTS.importBatchFailed,
                storageErr.operation,
                storageErr.message,
              );

              return { status: "processing" as const, processed: 0 };
            }),
          ),
        );
      });

      return Imports.of({
        latestForUser,
        checkUploadEligibility,
        acceptUpload,
        runTick,
      });
    }),
  );
}
