import { Effect, Schema } from "effect";
import { SqlClient, SqlSchema } from "effect/sql";
import type { Fragment } from "effect/sql/Statement";

import { DateFromEpochSeconds } from "../columns.ts";
import type { Album, Artist, Scrobble, Track, User } from "../schema.ts";
import { asDbError } from "../service.ts";

export type ProjectedArtist = Pick<Artist, "name"> & {
  spotifyUri?: Artist["spotifyUri"];
};

export type ProjectedTrack = Pick<Track, "name" | "imageUrl"> & {
  spotifyUri?: Track["spotifyUri"];
  artists: ProjectedArtist[];
};

export type ProjectedAlbum = Pick<Album, "name" | "imageUrl"> & {
  spotifyUri?: Album["spotifyUri"];
  releaseDate?: Album["releaseDate"];
  artists: ProjectedArtist[];
};

export type ProjectedScrobble = Pick<Scrobble, "id" | "scrobbleDate"> & {
  track: ProjectedTrack;
  album: ProjectedAlbum;
};

export type FeedItem = Pick<Scrobble, "id"> & {
  scrobbleDate: NonNullable<Scrobble["scrobbleDate"]>;
  user: Pick<User, "username" | "name" | "avatarUrl">;
  track: ProjectedTrack;
  album: Pick<Album, "name"> & {
    spotifyUri?: Album["spotifyUri"];
  };
};

export type FeedCursor = Pick<Scrobble, "id"> & {
  scrobbleDate: NonNullable<Scrobble["scrobbleDate"]>;
};

const ArtistCredits = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      name: Schema.String,
      spotifyUri: Schema.optionalKey(Schema.String),
      position: Schema.Int,
    }),
  ),
);

// Sorting each short credit list here avoids a temporary SQLite sort per play and credit list.
function orderedArtists(credits: typeof ArtistCredits.Type): ProjectedArtist[] {
  return credits
    .toSorted((a, b) => a.position - b.position)
    .map(({ position: _, ...artist }) => artist);
}

const PlayFields = {
  id: Schema.String,
  trackName: Schema.String,
  trackImageUrl: Schema.String,
  trackSpotifyUri: Schema.NullOr(Schema.String),
  trackArtists: ArtistCredits,
  albumName: Schema.String,
  albumSpotifyUri: Schema.NullOr(Schema.String),
};

const HistoryRow = Schema.Struct({
  ...PlayFields,
  scrobbleDate: Schema.NullOr(DateFromEpochSeconds),
  albumImageUrl: Schema.String,
  albumReleaseDate: Schema.optionalKey(Schema.NullOr(Schema.String)),
  albumArtists: ArtistCredits,
});

const FeedRow = Schema.Struct({
  ...PlayFields,
  scrobbleDate: DateFromEpochSeconds,
  username: Schema.String,
  displayName: Schema.String,
  avatarUrl: Schema.NullOr(Schema.String),
});

// Read credits independently so a collaboration on a compilation still yields one row per play.
function projectPage(sql: SqlClient.SqlClient, page: Fragment, extraColumns: Fragment) {
  return sql`
    WITH page AS (${page})
    SELECT p.id, p.scrobbleDate, p.trackSpotifyUri, p.albumSpotifyUri,
      coalesce(t.name, p.trackName, 'Unknown Track') AS trackName,
      coalesce(t.imageUrl, p.coverArtUrl, '') AS trackImageUrl,
      CASE WHEN t.spotifyUri IS NOT NULL THEN (
        SELECT json_group_array(json_object('name', a.name, 'spotifyUri', a.spotifyUri, 'position', credit.position))
        FROM track_artists AS credit JOIN artists AS a ON a.spotifyUri = credit.artist_spotify_uri
        WHERE credit.track_spotify_uri = t.spotifyUri
      ) WHEN nullif(p.artistName, '') IS NOT NULL THEN json_array(json_object('name', p.artistName, 'position', 0))
        ELSE '[]' END AS trackArtists,
      coalesce(album.name, p.albumName, '') AS albumName,
      ${extraColumns}
    FROM page AS p
    LEFT JOIN tracks AS t ON t.spotifyUri = p.trackSpotifyUri
    LEFT JOIN albums AS album ON album.spotifyUri = p.albumSpotifyUri
    ORDER BY p.scrobbleDate DESC, p.id DESC
  `;
}

function projectTrack(row: typeof HistoryRow.Type | typeof FeedRow.Type): ProjectedTrack {
  return {
    name: row.trackName,
    imageUrl: row.trackImageUrl,
    spotifyUri: row.trackSpotifyUri ?? undefined,
    artists: orderedArtists(row.trackArtists),
  };
}

export const findRecentScrobblesByUserId = Effect.fn("scrobbles.findRecentByUserId")(function* (
  userId: User["id"],
  {
    since,
    before,
    offset = 0,
    limit,
    pageAfter,
    includeAlbumArtists = true,
    includeAlbumReleaseDate = false,
  }: {
    since?: number;
    before?: NonNullable<Scrobble["scrobbleDate"]>;
    offset?: number;
    limit: number;
    pageAfter?: FeedCursor | null;
    includeAlbumArtists?: boolean;
    includeAlbumReleaseDate?: boolean;
  },
) {
  const sql = yield* SqlClient.SqlClient;

  const lowerBound = since === undefined ? sql`` : sql`AND s.scrobbleDate >= ${since}`;

  // A single upper bound lets SQLite seek directly to the start of this page.
  const upperBound = (() => {
    if (before && (!pageAfter || before <= pageAfter.scrobbleDate)) {
      return sql`AND s.scrobbleDate < ${Math.floor(before.getTime() / 1000)}`;
    }

    if (pageAfter) {
      return sql`AND (s.scrobbleDate, s.id) < (${Math.floor(pageAfter.scrobbleDate.getTime() / 1000)}, ${pageAfter.id})`;
    }

    return pageAfter === null ? sql`AND s.scrobbleDate IS NOT NULL` : sql``;
  })();

  const albumCredits = includeAlbumArtists
    ? sql`(
        SELECT json_group_array(json_object('name', a.name, 'spotifyUri', a.spotifyUri, 'position', credit.position))
        FROM album_artists AS credit JOIN artists AS a ON a.spotifyUri = credit.artist_spotify_uri
        WHERE credit.album_spotify_uri = album.spotifyUri
      )`
    : sql`'[]'`;

  const find = SqlSchema.findAll({
    Request: Schema.Struct({ userId: Schema.String, limit: Schema.Int, offset: Schema.Int }),
    Result: HistoryRow,
    execute: ({ userId, limit, offset }) =>
      projectPage(
        sql,
        sql`
          SELECT s.* FROM scrobbles AS s
          WHERE s.userId = ${userId} ${lowerBound} ${upperBound}
          ORDER BY s.scrobbleDate DESC, s.id DESC
          LIMIT ${limit} OFFSET ${offset}
        `,
        sql`
          coalesce(album.imageUrl, p.coverArtUrl, '') AS albumImageUrl,
          ${includeAlbumReleaseDate ? sql`album.releaseDate AS albumReleaseDate,` : sql``}
          ${albumCredits} AS albumArtists
        `,
      ),
  });

  const rows = yield* asDbError(find({ userId, limit, offset }));

  return rows.map(
    (row): ProjectedScrobble => ({
      id: row.id,
      scrobbleDate: row.scrobbleDate,
      track: projectTrack(row),
      album: {
        name: row.albumName,
        imageUrl: row.albumImageUrl,
        spotifyUri: row.albumSpotifyUri ?? undefined,
        ...(row.albumReleaseDate && { releaseDate: row.albumReleaseDate }),
        artists: orderedArtists(row.albumArtists),
      },
    }),
  );
});

export const findPublicFeed = Effect.fn("scrobbles.findPublicFeed")(function* ({
  cursor,
  limit,
}: {
  cursor?: FeedCursor;
  limit: number;
}) {
  const sql = yield* SqlClient.SqlClient;

  const before = cursor
    ? sql`AND (s.scrobbleDate, s.id) < (${Math.floor(cursor.scrobbleDate.getTime() / 1000)}, ${cursor.id})`
    : sql``;

  const find = SqlSchema.findAll({
    Request: Schema.Void,
    Result: FeedRow,
    execute: () =>
      projectPage(
        sql,
        sql`
          SELECT s.*, u.username, u.name AS displayName, u.avatarUrl
          FROM scrobbles AS s JOIN users AS u ON u.id = s.userId
          WHERE s.scrobbleDate IS NOT NULL AND u.isPrivate = 0 AND u.onboarded = 1 ${before}
          ORDER BY s.scrobbleDate DESC, s.id DESC LIMIT ${limit}
        `,
        sql`p.username, p.displayName, p.avatarUrl`,
      ),
  });

  const rows = yield* asDbError(find(undefined));

  return rows.map(
    (row): FeedItem => ({
      id: row.id,
      scrobbleDate: row.scrobbleDate,
      user: { username: row.username, name: row.displayName, avatarUrl: row.avatarUrl },
      track: projectTrack(row),
      album: { name: row.albumName, spotifyUri: row.albumSpotifyUri ?? undefined },
    }),
  );
});
