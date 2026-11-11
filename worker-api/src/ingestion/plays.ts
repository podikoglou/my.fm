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
 * Store one play and everything it references.
 *
 * MIGRATION NOTE: The Bun API issued these inserts one by one. D1 counts each
 * round trip against the per-invocation query limit, so this sends the same
 * statements as one batch, in the same order. A batch is a transaction: either
 * the whole play is stored or none of it is. All inserts use
 * `onConflictDoNothing`, so a re-fetched play stays idempotent.
 *
 * Returns the play time so the caller can advance the user's fetch cursor.
 */
export async function storePlay(db: Database, userId: User["id"], play: SpotifyPlay) {
  const scrobbleDate = new Date(play.played_at);
  const { track } = play;
  const album = track.album;

  const statements = [
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

  const [first, ...rest] = statements;

  if (!first) {
    throw new Error("A play must produce at least one statement");
  }

  await db.batch([first, ...rest]);

  return scrobbleDate;
}
