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

/**
 * D1 counts one `batch()` call as one query, so a whole fetch could go in a
 * single batch. A batch is also a transaction, though, so one failure would
 * roll back every play. Ten plays bounds that loss, and an initial fetch of
 * fifty plays becomes five batches.
 */
const PLAYS_PER_BATCH = 10;

/**
 * Store plays and their related rows.
 *
 * Every insert uses `onConflictDoNothing`, so a re-fetched play is idempotent.
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
 * Build the statements for one play in dependency order: artists, album,
 * album artists, track, track artists, then the scrobble that references them.
 *
 * The statements are returned and not awaited because `db.batch()` needs them.
 * A statement also works on its own, if a caller ever needs just one.
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
