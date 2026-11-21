import type { Database } from "../db/index.ts";
import type { Scrobble, User } from "../db/schema.ts";
import type { SpotifyPlay } from "./spotify.ts";

import { createScrobbleId, persistPlays, type PlayRecord } from "../db/queries/scrobbles.ts";

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
export async function storePlays(
  db: Database,
  userId: User["id"],
  plays: SpotifyPlay[],
): Promise<NonNullable<Scrobble["scrobbleDate"]>[]> {
  const records: PlayRecord[] = [];
  const scrobbleDates: NonNullable<Scrobble["scrobbleDate"]>[] = [];

  for (const play of plays) {
    const scrobbleDate = new Date(play.played_at);
    scrobbleDates.push(scrobbleDate);

    const { track } = play;
    const album = track.album;

    records.push({
      id: await createScrobbleId(userId, scrobbleDate),
      userId,
      scrobbleDate,
      track: {
        spotifyUri: track.uri,
        name: track.name,
        trackNumber: track.track_number,
        releaseDate: album.release_date,
        imageUrl: album.images[0]?.url ?? "",
        explicit: track.explicit,
        duration: track.duration_ms,
        artists: track.artists.map(({ name, uri }) => ({ spotifyUri: uri, name })),
      },
      album: {
        spotifyUri: album.uri,
        name: album.name,
        releaseDate: album.release_date,
        totalTracks: album.total_tracks,
        albumType: album.album_type,
        imageUrl: album.images[0]?.url ?? "",
        artists: album.artists.map(({ name, uri }) => ({ spotifyUri: uri, name })),
      },
    });
  }

  await persistPlays(db, records, { batchSize: PLAYS_PER_BATCH });

  return scrobbleDates;
}
