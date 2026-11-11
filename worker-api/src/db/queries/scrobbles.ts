import type { Database } from "../index.ts";

import { scrobbles, type ScrobbleInsert, type User } from "../schema.ts";

/**
 * Derive a deterministic scrobble ID from the user and the play time.
 *
 * A re-fetched play must get the same ID, so `onConflictDoNothing` can stop a
 * duplicate.
 *
 * MIGRATION NOTE: The Bun API used `Bun.hash.wyhash`; Workers use Web Crypto
 * SHA-256 instead, and the ID keeps the first 16 bytes as 32 lowercase hex
 * characters.
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

/**
 * Build a scrobble insert. Ingestion adds it to the play batch, after the
 * track and album it references.
 */
export function insertScrobble(db: Database, values: ScrobbleValues) {
  return db.insert(scrobbles).values(values).onConflictDoNothing().returning();
}

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
