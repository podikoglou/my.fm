import { sql } from "drizzle-orm";

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
  { offset, limit }: { offset: number; limit: number },
) {
  return await db.query.scrobbles.findMany({
    where: { userId },
    orderBy: { scrobbleDate: "desc" },
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
