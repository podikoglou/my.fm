import type { BatchItem } from "drizzle-orm/batch";

import type { Database } from "../db/index.ts";
import type { Import, Scrobble, User } from "../db/schema.ts";
import type { ResolvedTrackMetadata } from "./graphql.ts";

import { insertAlbumArtist } from "../db/queries/albumArtists.ts";
import { insertAlbum } from "../db/queries/albums.ts";
import { insertArtist } from "../db/queries/artists.ts";
import { findRecordedPlaysBetween, insertScrobble } from "../db/queries/scrobbles.ts";
import { insertTrackArtist } from "../db/queries/trackArtists.ts";
import { insertTrack } from "../db/queries/tracks.ts";
import { parseScrobbleRow, type CsvHeaderIndices, type ParsedScrobbleRow } from "./csv.ts";
import { extractResolvedMetadata } from "./graphql.ts";
import { computeImportScrobbleId, computeNormKeys } from "./normalize.ts";

const PLAYS_PER_D1_BATCH = 20;

/**
 * How far apart an imported play and a recorded play of the same track may be
 * and still count as one listen. An export stamps the start of a play
 * and a recorded play can carry its end, so the two differ by up to the
 * track's length.
 */
const RECORDED_PLAY_WINDOW_MS = 10 * 60 * 1000;

export type ImportedPlay = {
  row: ParsedScrobbleRow;
  scrobbleId: Scrobble["id"];
  normArtistKey: NonNullable<Scrobble["normArtistKey"]>;
  normTrackKey: NonNullable<Scrobble["normTrackKey"]>;
};

/** Read the lines that hold a play, each with its ID and its lookup keys. */
export async function readImportedPlays(
  userId: User["id"],
  lines: string[],
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

    plays.push({
      row,
      scrobbleId,
      normArtistKey,
      normTrackKey,
    });
  }

  return plays;
}

/**
 * Drop the plays that ingestion already recorded from Spotify, so an import
 * that overlaps the recorded history does not store those plays twice.
 *
 * The two sources share no ID and no exact time, so a play matches a recorded
 * play of the same normalized artist and title within the window.
 */
export async function withoutRecordedPlays(
  db: Database,
  userId: User["id"],
  plays: ImportedPlay[],
): Promise<ImportedPlay[]> {
  if (plays.length === 0) {
    return plays;
  }

  const times = plays.map((play) => play.row.playedAt.getTime());

  const recorded = await findRecordedPlaysBetween(
    db,
    userId,
    new Date(Math.min(...times) - RECORDED_PLAY_WINDOW_MS),
    new Date(Math.max(...times) + RECORDED_PLAY_WINDOW_MS),
  );

  const recordedTimes = new Map<string, number[]>();

  for (const { scrobbleDate, trackName, artistName } of recorded) {
    const { normTrackKey } = await computeNormKeys(artistName, trackName);

    recordedTimes.set(normTrackKey, [
      ...(recordedTimes.get(normTrackKey) ?? []),
      scrobbleDate.getTime(),
    ]);
  }

  return plays.filter((play) => {
    const playedAt = play.row.playedAt.getTime();
    const candidates = recordedTimes.get(play.normTrackKey) ?? [];

    const distances = candidates.map((time) => Math.abs(time - playedAt));
    const nearest = Math.min(...distances);

    if (nearest > RECORDED_PLAY_WINDOW_MS) {
      return true;
    }

    // One recorded play accounts for one row, so a track on repeat keeps the
    // listens that ingestion did not record. The nearest one is taken, which
    // leaves the recorded play of a neighbouring listen for its own row.
    candidates.splice(distances.indexOf(nearest), 1);

    return false;
  });
}

/**
 * Store imported plays and the rows their metadata links to.
 *
 * Every insert uses `onConflictDoNothing`, so a batch that runs twice stores
 * each play once. A play without resolved metadata keeps the names from its
 * row and links to no track.
 */
export async function storeImportedPlays(
  db: Database,
  { id: importId, userId }: Pick<Import, "id" | "userId">,
  plays: ImportedPlay[],
  resolved: Map<string, ResolvedTrackMetadata>,
): Promise<void> {
  for (let start = 0; start < plays.length; start += PLAYS_PER_D1_BATCH) {
    const statements = plays
      .slice(start, start + PLAYS_PER_D1_BATCH)
      .flatMap((play) =>
        buildPlayStatements(
          db,
          { importId, userId },
          play,
          resolved.get(play.normTrackKey) ??
            extractResolvedMetadata(play.row.artist, play.row.track, play.row.album, null),
        ),
      );

    const [first, ...rest] = statements;

    if (first) {
      await db.batch([first, ...rest]);
    }
  }
}

/**
 * Build the statements for one play in dependency order: artist, album,
 * track, then the scrobble that references them.
 */
function buildPlayStatements(
  db: Database,
  { importId, userId }: { importId: Import["id"]; userId: User["id"] },
  play: ImportedPlay,
  metadata: ResolvedTrackMetadata,
): BatchItem<"sqlite">[] {
  const statements: BatchItem<"sqlite">[] = [];

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
      id: play.scrobbleId,
      userId,
      trackSpotifyUri: effectiveTrackSpotifyUri,
      albumSpotifyUri: effectiveAlbumSpotifyUri,
      coverArtUrl: metadata.coverArtUrl,
      artistName: metadata.artistName,
      // Plays that share a track key share one lookup, and the retry
      // without the album drops it, so the row's own album is the fallback.
      albumName: metadata.albumName ?? play.row.album,
      trackName: metadata.trackName,
      normArtistKey: play.normArtistKey,
      normTrackKey: play.normTrackKey,
      scrobbleDate: play.row.playedAt,
      importId,
    }),
  );

  return statements;
}
