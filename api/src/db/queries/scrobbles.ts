import { eq } from "drizzle-orm";
import { db } from "..";
import { scrobbles, type ScrobbleInsert, type User } from "../schema";

export async function createScrobble(
  values: Pick<ScrobbleInsert, "userId" | "trackSpotifyUri" | "albumSpotifyUri" | "scrobbleDate">,
) {
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
    offset,
    limit,
    with: {
      track: true,
      album: true,
    },
  });
}
