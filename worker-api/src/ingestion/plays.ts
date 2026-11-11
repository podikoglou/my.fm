import type { BatchItem } from "drizzle-orm/batch";

import type { Database } from "../db/index.ts";
import type { User } from "../db/schema.ts";
import type { SpotifyPlay } from "./spotify.ts";

import { insertAlbumArtist } from "../db/queries/albumArtists.ts";
import { insertAlbum } from "../db/queries/albums.ts";
import { insertArtist } from "../db/queries/artists.ts";
import { createScrobbleId, insertScrobble } from "../db/queries/scrobbles.ts";
import { insertTrackArtist } from "../db/queries/trackArtists.ts";
import { insertTrack } from "../db/queries/tracks.ts";

const PLAYS_PER_BATCH = 10;

/**
 * Store fetched plays and everything they reference.
 *
 * MIGRATION NOTE: The Bun API issued these inserts one by one. D1 counts one
 * `db.batch()` call as one query against the per-invocation limit, so this
 * sends the statements in batches. A single batch for a whole fetch would be
 * one query, but a failure would roll back every play. Ten plays per batch
 * bounds the rollback while keeping an initial fetch of fifty plays at five
 * batches. A batch is a transaction: either the whole chunk is stored or none
 * of it is. All inserts use `onConflictDoNothing`, so a re-fetched play stays
 * idempotent.
 *
 * Returns the play times so the caller can advance the user's fetch cursor.
 */
export async function storePlays(db: Database, userId: User["id"], plays: SpotifyPlay[]) {
  const scrobbleDates: Date[] = [];

  for (let start = 0; start < plays.length; start += PLAYS_PER_BATCH) {
    const chunk = plays.slice(start, start + PLAYS_PER_BATCH);
    const statements: BatchItem<"sqlite">[] = [];

    for (const play of chunk) {
      const scrobbleDate = new Date(play.played_at);
      scrobbleDates.push(scrobbleDate);
      statements.push(...(await buildPlayStatements(db, userId, play, scrobbleDate)));
    }

    const [first, ...rest] = statements;

    if (first) {
      await db.batch([first, ...rest]);
    }
  }

  return scrobbleDates;
}

/**
 * MIGRATION NOTE: Build the statements for one play in the order the Bun API
 * issued them.
 */
async function buildPlayStatements(
  db: Database,
  userId: User["id"],
  play: SpotifyPlay,
  scrobbleDate: Date,
): Promise<BatchItem<"sqlite">[]> {
  const { track } = play;
  const album = track.album;

  return [
    // Insert the track's and album's artists first; both insert styles are
    // used because the two lists are not guaranteed to match.
    ...track.artists.map(({ name, uri }) => insertArtist(db, { spotifyUri: uri, name })),
    ...album.artists.map(({ name, uri }) => insertArtist(db, { spotifyUri: uri, name })),

    insertAlbum(db, {
      spotifyUri: album.uri,
      name: album.name,
      releaseDate: album.release_date,
      totalTracks: album.total_tracks,
      albumType: album.album_type,
      imageUrl: album.images[0]?.url ?? "",
    }),

    ...album.artists.map(({ uri }, position) => insertAlbumArtist(db, album.uri, uri, position)),

    insertTrack(db, {
      spotifyUri: track.uri,
      name: track.name,
      trackNumber: track.track_number,
      releaseDate: album.release_date,
      imageUrl: album.images[0]?.url ?? "",
      explicit: track.explicit,
      duration: track.duration_ms,
    }),

    ...track.artists.map(({ uri }, position) => insertTrackArtist(db, track.uri, uri, position)),

    insertScrobble(db, {
      id: await createScrobbleId(userId, scrobbleDate),
      userId,
      trackSpotifyUri: track.uri,
      albumSpotifyUri: album.uri,
      scrobbleDate,
    }),
  ];
}
