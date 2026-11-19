import type { BatchItem } from "drizzle-orm/batch";

import type { WorkerEnv } from "../alchemy.ts";
import type { Database } from "../db/index.ts";
import type { GqlTrack, QueryItem, ResolvedTrackMetadata } from "../import/graphql.ts";

import { describeError, getD1QuotaError } from "../db/errors.ts";
import { createDatabase } from "../db/index.ts";
import { insertAlbumArtist } from "../db/queries/albumArtists.ts";
import { insertAlbum } from "../db/queries/albums.ts";
import { insertArtist } from "../db/queries/artists.ts";
import {
  findActiveImportForCron,
  updateImport,
  updateImportAtCursor,
} from "../db/queries/imports.ts";
import { findRecordedPlaysBetween, insertScrobble } from "../db/queries/scrobbles.ts";
import { insertTrackArtist } from "../db/queries/trackArtists.ts";
import { insertTrack } from "../db/queries/tracks.ts";
import {
  getImportR2Key,
  parseCsvHeaders,
  parseScrobbleRow,
  splitCsvLines,
  type ParsedScrobbleRow,
} from "../import/csv.ts";
import { extractResolvedMetadata } from "../import/graphql.ts";
import { computeImportScrobbleId, computeNormKeys } from "../import/normalize.ts";
import { resolveTracksWaterfall } from "../import/resolver.ts";
import {
  INGESTION_EVENTS,
  d1QuotaEventName,
  logIngestionEvent,
  logIngestionFailure,
} from "./events.ts";

export const IMPORT_LINES_PER_RUN = 500;

export const PLAYS_PER_D1_BATCH = 20;

/**
 * Consecutive batch failures tolerated before an import is abandoned. The
 * cron trigger runs every minute, so three failures hold the queue for only
 * a few minutes before the import gives up.
 */
const IMPORT_MAX_ATTEMPTS = 3;

const IMPORT_GAVE_UP_ERROR = "Import failed after repeated metadata batch errors";

/**
 * How far apart an imported play and a recorded play of the same track may be
 * and still count as one listen. An export stamps the start of a play
 * and a recorded play can carry its end, so the two differ by up to the
 * track's length.
 */
const RECORDED_PLAY_WINDOW_MS = 10 * 60 * 1000;

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

type ValidRowItem = {
  row: ParsedScrobbleRow;
  scrobbleId: string;
  normArtistKey: string;
  normTrackKey: string;
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

  const fileText = await r2Object.text();
  const lines = splitCsvLines(fileText);
  const totalLines = lines.length;

  const [firstLine] = lines;

  if (lines.length < 2 || !firstLine) {
    await updateImport(db, activeImport.id, {
      status: "failed",
      error: "CSV file contains no data rows",
      totalLines,
    });

    await env.IMPORTS_BUCKET.delete(r2Key);

    return { status: "failed", processed: 0 };
  }

  const headerIndices = parseCsvHeaders(firstLine);

  if (!headerIndices) {
    await updateImport(db, activeImport.id, {
      status: "failed",
      error: "Missing required CSV headers",
      totalLines,
    });

    await env.IMPORTS_BUCKET.delete(r2Key);

    return { status: "failed", processed: 0 };
  }

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

  const parsedItems: ValidRowItem[] = [];
  let skippedInBatch = 0;

  for (const line of batchLines) {
    const row = parseScrobbleRow(line, headerIndices);

    if (!row) {
      skippedInBatch++;
      continue;
    }

    const { normArtistKey, normTrackKey } = await computeNormKeys(row.artist, row.track);

    const scrobbleId = await computeImportScrobbleId(
      activeImport.userId,
      row.playedAt.toISOString(),
      normTrackKey,
    );

    parsedItems.push({
      row,
      scrobbleId,
      normArtistKey,
      normTrackKey,
    });
  }

  const validItems = await withoutRecordedPlays(db, activeImport.userId, parsedItems);

  skippedInBatch += parsedItems.length - validItems.length;

  const queryItems: QueryItem[] = validItems.map((item) => ({
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

    await persistBatch(db, activeImport.userId, activeImport.id, validItems, resolvedMap);
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
    processed: validItems.length,
  });

  const newProcessed = activeImport.processedRows + validItems.length;
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
    processed: validItems.length,
    skipped: skippedInBatch,
  };
}

/**
 * Drop the rows that ingestion already recorded from Spotify, so an import
 * that overlaps the recorded history does not store those plays twice.
 *
 * The two sources share no ID and no exact time, so a row matches a recorded
 * play of the same normalized artist and title within the window.
 */
async function withoutRecordedPlays(
  db: Database,
  userId: string,
  items: ValidRowItem[],
): Promise<ValidRowItem[]> {
  if (items.length === 0) {
    return items;
  }

  const times = items.map((item) => item.row.playedAt.getTime());

  const recorded = await findRecordedPlaysBetween(
    db,
    userId,
    new Date(Math.min(...times) - RECORDED_PLAY_WINDOW_MS),
    new Date(Math.max(...times) + RECORDED_PLAY_WINDOW_MS),
  );

  const recordedTimes = new Map<string, number[]>();

  for (const { scrobbleDate, track } of recorded) {
    const [first] = track?.trackArtists.toSorted((a, b) => a.position - b.position) ?? [];

    if (!scrobbleDate || !track || !first) {
      continue;
    }

    const { normTrackKey } = await computeNormKeys(first.artist.name, track.name);

    recordedTimes.set(normTrackKey, [
      ...(recordedTimes.get(normTrackKey) ?? []),
      scrobbleDate.getTime(),
    ]);
  }

  return items.filter((item) => {
    const playedAt = item.row.playedAt.getTime();
    const matches = recordedTimes.get(item.normTrackKey) ?? [];

    return !matches.some((time) => Math.abs(time - playedAt) <= RECORDED_PLAY_WINDOW_MS);
  });
}

async function persistBatch(
  db: Database,
  userId: string,
  importId: string,
  items: ValidRowItem[],
  resolvedMap: Map<string, ResolvedTrackMetadata>,
): Promise<void> {
  for (let i = 0; i < items.length; i += PLAYS_PER_D1_BATCH) {
    const chunk = items.slice(i, i + PLAYS_PER_D1_BATCH);
    const statements: BatchItem<"sqlite">[] = [];

    for (const item of chunk) {
      const metadata =
        resolvedMap.get(item.normTrackKey) ??
        extractResolvedMetadata(item.row.artist, item.row.track, item.row.album, null);

      let effectiveTrackSpotifyUri: string | null = null;
      let effectiveAlbumSpotifyUri: string | null = null;

      if (metadata.trackSpotifyUri) {
        effectiveTrackSpotifyUri = metadata.trackSpotifyUri;

        if (metadata.artistSpotifyUri) {
          statements.push(
            insertArtist(db, {
              spotifyUri: metadata.artistSpotifyUri,
              name: metadata.artistName,
              imageUrl: metadata.artistImageUrl,
            }),
          );
        }

        if (metadata.albumSpotifyUri) {
          effectiveAlbumSpotifyUri = metadata.albumSpotifyUri;

          statements.push(
            insertAlbum(db, {
              spotifyUri: metadata.albumSpotifyUri,
              name: metadata.albumName ?? "Unknown Album",
              releaseDate: metadata.albumReleaseDate,
              totalTracks: 1,
              albumType: metadata.albumType,
              imageUrl: metadata.coverArtUrl ?? "",
            }),
          );

          if (metadata.artistSpotifyUri) {
            statements.push(
              insertAlbumArtist(db, metadata.albumSpotifyUri, metadata.artistSpotifyUri, 0),
            );
          }
        }

        statements.push(
          insertTrack(db, {
            spotifyUri: metadata.trackSpotifyUri,
            name: metadata.trackName,
            trackNumber: 1,
            releaseDate: metadata.albumReleaseDate,
            imageUrl: metadata.coverArtUrl ?? "",
            explicit: false,
            duration: 0,
          }),
        );

        if (metadata.artistSpotifyUri) {
          statements.push(
            insertTrackArtist(db, metadata.trackSpotifyUri, metadata.artistSpotifyUri, 0),
          );
        }
      }

      statements.push(
        insertScrobble(db, {
          id: item.scrobbleId,
          userId,
          trackSpotifyUri: effectiveTrackSpotifyUri,
          albumSpotifyUri: effectiveAlbumSpotifyUri,
          coverArtUrl: metadata.coverArtUrl,
          artistName: metadata.artistName,
          // Plays that share a track key share one lookup, and the retry
          // without the album drops it, so the row's own album is the fallback.
          albumName: metadata.albumName ?? item.row.album,
          trackName: metadata.trackName,
          normArtistKey: item.normArtistKey,
          normTrackKey: item.normTrackKey,
          scrobbleDate: item.row.playedAt,
          importId,
        }),
      );
    }

    const [first, ...rest] = statements;

    if (first) {
      await db.batch([first, ...rest]);
    }
  }
}
