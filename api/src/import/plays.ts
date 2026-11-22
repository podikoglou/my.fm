import { Effect } from "effect";

import type { DbError } from "../db/errors.ts";
import type { Import, Scrobble, User } from "../db/schema.ts";
import type { CsvHeaderIndices, ParsedScrobbleRow } from "./csv.ts";
import type { ResolvedTrackMetadata } from "./graphql.ts";

import {
  findRecordedPlaysBetween,
  persistPlays,
  type PlayRecord,
} from "../db/queries/scrobbles.ts";
import { Db } from "../db/service.ts";
import { parseScrobbleRow } from "./csv.ts";
import { computeImportScrobbleId, computeNormKeys } from "./normalize.ts";

/**
 * Plays persisted in one D1 batch. Imported plays write at most five
 * statements each, well under D1's statement limit per batch.
 */
const PLAYS_PER_D1_BATCH = 20;

/**
 * Spotify records when a track finishes and last.fm when it starts, so the
 * same play appears minutes apart. An imported play within this window of a
 * recorded play of the same track is treated as already recorded.
 */
const RECORDED_PLAY_WINDOW_MS = 10 * 60 * 1000;

export type ImportedPlay = {
  readonly row: ParsedScrobbleRow;
  readonly scrobbleId: Scrobble["id"];
  readonly normArtistKey: NonNullable<Scrobble["normArtistKey"]>;
  readonly normTrackKey: NonNullable<Scrobble["normTrackKey"]>;
};

export async function readImportedPlays(
  userId: User["id"],
  lines: ReadonlyArray<string>,
  headers: CsvHeaderIndices,
): Promise<ImportedPlay[]> {
  const plays: ImportedPlay[] = [];

  for (const line of lines) {
    const row = parseScrobbleRow(line, headers);

    if (!row) {
      continue;
    }

    const { normArtistKey, normTrackKey } = await computeNormKeys(row.artist, row.track);

    const scrobbleId = await computeImportScrobbleId(
      userId,
      row.playedAt.toISOString(),
      normTrackKey,
    );

    plays.push({ row, scrobbleId, normArtistKey, normTrackKey });
  }

  return plays;
}

/**
 * Drop plays that Spotify already recorded, matching each recorded play at
 * most once so a track played twice in ten minutes keeps the second play.
 */
export const withoutRecordedPlays = Effect.fn("import.withoutRecordedPlays")(function* (
  userId: User["id"],
  plays: ReadonlyArray<ImportedPlay>,
): Effect.fn.Return<ImportedPlay[], DbError, Db> {
  if (plays.length === 0) {
    return [];
  }

  const db = yield* Db;

  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const { row } of plays) {
    const time = row.playedAt.getTime();

    if (time < earliest) {
      earliest = time;
    }

    if (time > latest) {
      latest = time;
    }
  }

  const recorded = yield* db.query((client) =>
    findRecordedPlaysBetween(
      client,
      userId,
      new Date(earliest - RECORDED_PLAY_WINDOW_MS),
      new Date(latest + RECORDED_PLAY_WINDOW_MS),
    ),
  );

  if (recorded.length === 0) {
    return [...plays];
  }

  const recordedByTrack = new Map<string, number[]>();

  for (const play of recorded) {
    const { normTrackKey } = yield* Effect.promise(() =>
      computeNormKeys(play.artistName, play.trackName),
    );

    const times = recordedByTrack.get(normTrackKey) ?? [];

    times.push(play.scrobbleDate.getTime());
    recordedByTrack.set(normTrackKey, times);
  }

  const remaining: ImportedPlay[] = [];

  for (const play of plays) {
    const times = recordedByTrack.get(play.normTrackKey);

    if (!times) {
      remaining.push(play);
      continue;
    }

    const playedAt = play.row.playedAt.getTime();
    let nearest = -1;
    let nearestGap = RECORDED_PLAY_WINDOW_MS + 1;

    for (let i = 0; i < times.length; i++) {
      const recordedAt = times[i];

      if (recordedAt === undefined) {
        continue;
      }

      const gap = Math.abs(playedAt - recordedAt);

      if (gap < nearestGap) {
        nearest = i;
        nearestGap = gap;
      }
    }

    if (nearest >= 0) {
      times.splice(nearest, 1);
    } else {
      remaining.push(play);
    }
  }

  return remaining;
});

function toPlayRecord(
  importId: Import["id"],
  userId: User["id"],
  { row, scrobbleId, normArtistKey, normTrackKey }: ImportedPlay,
  meta: ResolvedTrackMetadata | undefined,
): PlayRecord {
  const artist =
    meta?.artistSpotifyUri !== null && meta?.artistSpotifyUri !== undefined
      ? {
          name: meta.artistName,
          spotifyUri: meta.artistSpotifyUri,
          imageUrl: meta.artistImageUrl,
        }
      : undefined;

  const album =
    meta?.trackSpotifyUri !== null &&
    meta?.trackSpotifyUri !== undefined &&
    meta.albumSpotifyUri !== null &&
    meta.albumSpotifyUri !== undefined
      ? {
          name: meta.albumName ?? row.album ?? "",
          spotifyUri: meta.albumSpotifyUri,
          releaseDate: meta.albumReleaseDate,
          totalTracks: 0,
          albumType: meta.albumType,
          imageUrl: meta.coverArtUrl ?? "",
          artists: artist ? [artist] : undefined,
        }
      : undefined;

  const track =
    meta?.trackSpotifyUri !== null && meta?.trackSpotifyUri !== undefined
      ? {
          name: meta.trackName,
          spotifyUri: meta.trackSpotifyUri,
          releaseDate: meta.albumReleaseDate,
          imageUrl: meta.coverArtUrl ?? "",
          artists: artist ? [artist] : undefined,
        }
      : undefined;

  return {
    id: scrobbleId,
    userId,
    scrobbleDate: row.playedAt,
    track,
    album,
    artistName: meta?.artistName ?? row.artist,
    albumName: meta?.albumName ?? row.album,
    trackName: meta?.trackName ?? row.track,
    coverArtUrl: meta?.coverArtUrl ?? null,
    normArtistKey,
    normTrackKey,
    importId,
  };
}

export const storeImportedPlays = Effect.fn("import.storeImportedPlays")(function* (
  { id: importId, userId }: Pick<Import, "id" | "userId">,
  plays: ReadonlyArray<ImportedPlay>,
  resolved: Map<string, ResolvedTrackMetadata>,
): Effect.fn.Return<void, DbError, Db> {
  const db = yield* Db;

  const records = plays.map((play) =>
    toPlayRecord(importId, userId, play, resolved.get(play.normTrackKey)),
  );

  yield* db.query((client) => persistPlays(client, records, { batchSize: PLAYS_PER_D1_BATCH }));
});
