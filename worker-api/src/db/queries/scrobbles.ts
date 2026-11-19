import { and, count, eq, isNotNull, max, min, sql } from "drizzle-orm";

import type { Database } from "../index.ts";

import { monthsBetween } from "../../time-zone.ts";
import { scrobbles, type ScrobbleInsert, type User } from "../schema.ts";

/**
 * Derive a deterministic scrobble ID from the user and the play time.
 *
 * A re-fetched play must get the same ID, so `onConflictDoNothing` can stop a
 * duplicate. The ID keeps the first 16 bytes of the SHA-256 digest as 32
 * lowercase hex characters.
 */
export async function createScrobbleId(userId: User["id"], scrobbleDate: Date) {
  const key = `${userId}:${scrobbleDate.toISOString()}`;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(key));

  return Array.from(new Uint8Array(digest).slice(0, 16), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export type ScrobbleValues = Pick<
  ScrobbleInsert,
  | "userId"
  | "trackSpotifyUri"
  | "albumSpotifyUri"
  | "coverArtUrl"
  | "artistName"
  | "albumName"
  | "trackName"
  | "normArtistKey"
  | "normTrackKey"
  | "scrobbleDate"
  | "importId"
> & { id: string };

export function insertScrobble(db: Database, values: ScrobbleValues) {
  return db.insert(scrobbles).values(values).onConflictDoNothing().returning();
}

/**
 * The plays that ingestion recorded for a user between two times, with each
 * track's name and artists. Imported plays are left out.
 */
export async function findRecordedPlaysBetween(
  db: Database,
  userId: User["id"],
  from: Date,
  to: Date,
) {
  return await db.query.scrobbles.findMany({
    where: { userId, importId: { isNull: true }, scrobbleDate: { gte: from, lte: to } },
    columns: { scrobbleDate: true },
    with: {
      track: {
        columns: { name: true },
        with: {
          trackArtists: {
            columns: { position: true },
            with: { artist: { columns: { name: true } } },
          },
        },
      },
    },
  });
}

/** `offset` pages backwards from the newest scrobble. */
export async function findRecentScrobblesByUserId(
  db: Database,
  userId: User["id"],
  { before, offset, limit }: { before?: Date; offset: number; limit: number },
) {
  return await db.query.scrobbles.findMany({
    where: before ? { userId, scrobbleDate: { lt: before } } : { userId },
    orderBy: { scrobbleDate: "desc", id: "desc" },
    offset,
    limit,
    with: {
      track: {
        with: {
          trackArtists: {
            with: {
              artist: true,
            },
          },
        },
      },
      album: {
        with: {
          albumArtists: {
            with: {
              artist: true,
            },
          },
        },
      },
    },
  });
}

export type FeedCursor = {
  scrobbleDate: Date;
  id: string;
};

/**
 * Read the global feed. Only public, onboarded users appear, and the cursor
 * continues after the last row of the previous page.
 *
 * The row-value comparison keeps the keyset on one index range. An `OR` of
 * two comparisons can make the planner read the index twice.
 */
export async function findPublicFeed(
  db: Database,
  { cursor, limit }: { cursor?: FeedCursor; limit: number },
) {
  return await db.query.scrobbles.findMany({
    where: {
      user: { isPrivate: false, onboarded: true },
      scrobbleDate: { isNotNull: true as const },
      RAW: (table: typeof scrobbles) =>
        cursor
          ? sql`(${table.scrobbleDate}, ${table.id}) < (${Math.floor(
              cursor.scrobbleDate.getTime() / 1000,
            )}, ${cursor.id})`
          : sql`1 = 1`,
    },
    orderBy: { scrobbleDate: "desc", id: "desc" },
    limit,
    columns: {
      id: true,
      scrobbleDate: true,
      artistName: true,
      albumName: true,
      trackName: true,
      coverArtUrl: true,
      trackSpotifyUri: true,
      albumSpotifyUri: true,
    },
    with: {
      user: {
        columns: {
          username: true,
          name: true,
          avatarUrl: true,
        },
      },
      album: {
        columns: {
          name: true,
          spotifyUri: true,
        },
      },
      track: {
        columns: {
          name: true,
          imageUrl: true,
          spotifyUri: true,
        },
        with: {
          trackArtists: {
            columns: { position: true },
            with: {
              artist: {
                columns: { name: true, spotifyUri: true },
              },
            },
            orderBy: { position: "asc" },
          },
        },
      },
    },
  });
}

export type FeedRow = Awaited<ReturnType<typeof findPublicFeed>>[number];

/**
 * Count one user's scrobbles per calendar month in the viewer's time zone,
 * newest month first. Months with no plays are left out.
 *
 * Month boundaries are local midnights computed per month, so a play just after
 * midnight on the 1st counts toward the new month in summer and winter alike.
 */
export async function countScrobblesByMonth(
  db: Database,
  userId: User["id"],
  { timeZone }: { timeZone: string },
) {
  const where = and(eq(scrobbles.userId, userId), isNotNull(scrobbles.scrobbleDate));

  const [range] = await db
    .select({ first: min(scrobbles.scrobbleDate), last: max(scrobbles.scrobbleDate) })
    .from(scrobbles)
    .where(where);

  if (!range?.first || !range.last) return [];

  const months = monthsBetween(range.first, range.last, timeZone);

  // D1 caps bound parameters at 100 per query, so the boundaries are inlined.
  // Every inlined value is an integer or a "YYYY-MM" string built from integers.
  const month = sql<string>`CASE ${sql.join(
    months.map(
      ({ month, start }) =>
        sql`WHEN ${scrobbles.scrobbleDate} >= ${sql.raw(String(start))} THEN ${sql.raw(`'${month}'`)}`,
    ),
    sql` `,
  )} END`;

  const counts = await db
    .select({ month, count: count() })
    .from(scrobbles)
    .where(where)
    .groupBy(month);

  return months.flatMap(({ month }) => counts.filter((row) => row.month === month));
}
