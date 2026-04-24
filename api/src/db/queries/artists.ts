import { db } from "..";
import { artists, type ArtistInsert } from "../schema";

export async function createArtist(values: ArtistInsert) {
  return await db.insert(artists).values(values).onConflictDoNothing().returning();
}
