import type { BatchItem } from "drizzle-orm/batch";

import type { WorkerEnv } from "../alchemy.ts";
import type { Database } from "../db/index.ts";
import type { GqlTrack, QueryItem, ResolvedTrackMetadata } from "../import/graphql.ts";

import { createDatabase } from "../db/index.ts";
import { insertAlbumArtist } from "../db/queries/albumArtists.ts";
import { insertAlbum } from "../db/queries/albums.ts";
import { insertArtist } from "../db/queries/artists.ts";
import { findActiveImportForCron, updateImport } from "../db/queries/imports.ts";
import { insertScrobble } from "../db/queries/scrobbles.ts";
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

export const IMPORT_LINES_PER_RUN = 500;

export const PLAYS_PER_D1_BATCH = 20;

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

export async function runImportIngestion(env: WorkerEnv, options?: ImportIngestionOptions) {
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

  if (lines.length < 2) {
    await updateImport(db, activeImport.id, {
      status: "failed",
      error: "CSV file contains no data rows",
      totalLines,
    });

    await env.IMPORTS_BUCKET.delete(r2Key);

    return { status: "failed", processed: 0 };
  }

  const firstLine = lines[0];

  if (!firstLine) {
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

  const validItems: ValidRowItem[] = [];
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

    validItems.push({
      row,
      scrobbleId,
      normArtistKey,
      normTrackKey,
    });
  }

  const queryItems: QueryItem[] = validItems.map((item) => ({
    key: item.normTrackKey,
    artist: item.row.artist,
    title: item.row.track,
    album: item.row.album,
  }));

  const resolvedMap = await resolveTracksWaterfall(queryItems, {
    throttleMs: options?.throttleMs,
    fetchBatch: options?.fetchBatch,
  });

  await persistBatch(db, activeImport.userId, activeImport.id, validItems, resolvedMap);

  const newProcessed = activeImport.processedRows + validItems.length;
  const newSkipped = activeImport.skippedRows + skippedInBatch;
  const isFinished = endIndex >= lines.length;

  if (isFinished) {
    await updateImport(db, activeImport.id, {
      cursor: endIndex,
      processedRows: newProcessed,
      skippedRows: newSkipped,
      totalLines,
      status: "completed",
    });

    await env.IMPORTS_BUCKET.delete(r2Key);
  } else {
    await updateImport(db, activeImport.id, {
      cursor: endIndex,
      processedRows: newProcessed,
      skippedRows: newSkipped,
      totalLines,
      status: "processing",
    });
  }

  return {
    status: isFinished ? "completed" : "processing",
    processed: validItems.length,
    skipped: skippedInBatch,
  };
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

      if (metadata.trackSpotifyUri) {
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
          trackSpotifyUri: metadata.trackSpotifyUri,
          albumSpotifyUri: metadata.albumSpotifyUri,
          coverArtUrl: metadata.coverArtUrl,
          artistName: metadata.artistName,
          albumName: metadata.albumName,
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
