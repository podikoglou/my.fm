import { desc, eq } from "drizzle-orm";

import { db } from "..";
import { scrobbles, type ScrobbleInsert, type User } from "../schema";

export async function createScrobble(
  values: Pick<ScrobbleInsert, "userId" | "trackSpotifyUri" | "albumSpotifyUri" | "scrobbleDate">,
) {
  // we use a hash here instead of a randomly generated ID to avoid re-adding the same scrobble if it happens to be fetched again (which probably won't happen)
  const id = Bun.hash.wyhash(`${values.userId}:${values.scrobbleDate}`).toString();

  return await db
    .insert(scrobbles)
    .values({ ...values, id })
    .onConflictDoNothing()
    .returning();
}

export async function findRecentScrobblesByUserId(
  userId: User["id"],
  { offset, limit }: { offset: number; limit: number },
) {
  return await db.query.scrobbles.findMany({
    where: eq(scrobbles.userId, userId),
    orderBy: [desc(scrobbles.scrobbleDate)],
    offset,
    limit,
    with: {
      track: true,
      album: true,
    },
  });
}
