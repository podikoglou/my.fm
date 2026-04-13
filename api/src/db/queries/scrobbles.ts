import { nanoid } from "nanoid";
import { db } from "..";
import { scrobbles, type ScrobbleInsert } from "../schema";

export async function addScrobble(
  values: Pick<ScrobbleInsert, "userId" | "trackSpotifyUri" | "albumSpotifyUri" | "scrobbleDate">,
) {
  const id = nanoid();

  return await db
    .insert(scrobbles)
    .values({ ...values, id })
    .returning();
}
