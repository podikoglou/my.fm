import { db } from "..";
import { scrobbles, type ScrobbleInsert } from "../schema";

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
