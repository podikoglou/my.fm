import { and, count, eq, isNotNull, max, min, sql } from "drizzle-orm";

import type { Database } from "../index.ts";

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
  "userId" | "trackSpotifyUri" | "albumSpotifyUri" | "scrobbleDate"
> & { id: string };

export function insertScrobble(db: Database, values: ScrobbleValues) {
  return db.insert(scrobbles).values(values).onConflictDoNothing().returning();
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

function utcOffsetMs(instant: number, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
  }).formatToParts(instant);

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((candidate) => candidate.type === type)?.value);

  return (
    Date.UTC(
      part("year"),
      part("month") - 1,
      part("day"),
      part("hour"),
      part("minute"),
      part("second"),
    ) -
    Math.floor(instant / 1000) * 1000
  );
}

const HOUR_MS = 3_600_000;

/**
 * The instant local midnight starts the month, resolved the way `new Date(year,
 * monthIndex, 1)` resolves it in the browser: a midnight that occurs twice
 * takes the first, and one skipped by a DST gap moves forward past the gap.
 */
function startOfMonthIn(year: number, monthIndex: number, timeZone: string) {
  const wallClock = Date.UTC(year, monthIndex, 1);

  // Every zone's offset lies within UTC-12 and UTC+14, so these two samples
  // bracket the boundary with at most one transition between them.
  const offsetBefore = utcOffsetMs(wallClock - 14 * HOUR_MS, timeZone);
  const offsetAfter = utcOffsetMs(wallClock + 14 * HOUR_MS, timeZone);

  const candidates = [wallClock - offsetBefore, wallClock - offsetAfter].filter(
    (instant) => instant === wallClock - utcOffsetMs(instant, timeZone),
  );

  return candidates.length > 0 ? Math.min(...candidates) : wallClock - offsetBefore;
}

/**
 * Every calendar month in `timeZone` from `first` to `last`, newest first,
 * with the instant it starts.
 */
function monthsBetween(first: Date, last: Date, timeZone: string) {
  const local = (date: Date) => new Date(date.getTime() + utcOffsetMs(date.getTime(), timeZone));
  const from = local(first);
  const to = local(last);
  const months = [];

  for (
    let year = to.getUTCFullYear(), monthIndex = to.getUTCMonth();
    year > from.getUTCFullYear() ||
    (year === from.getUTCFullYear() && monthIndex >= from.getUTCMonth());
    monthIndex === 0 ? ((year -= 1), (monthIndex = 11)) : (monthIndex -= 1)
  ) {
    months.push({
      month: `${year}-${String(monthIndex + 1).padStart(2, "0")}`,
      start: Math.floor(startOfMonthIn(year, monthIndex, timeZone) / 1000),
    });
  }

  return months;
}

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
