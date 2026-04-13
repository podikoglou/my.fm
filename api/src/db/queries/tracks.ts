import { db } from "..";
import { tracks, type TrackInsert } from "../schema";
import { eq } from "drizzle-orm";

export async function createTrack(values: TrackInsert) {
  return await db.insert(tracks).values(values).onConflictDoNothing().returning();
}

export async function findTrackBySpotifyUri(spotifyUri: TrackInsert["spotifyUri"]) {
  return await db.query.tracks.findFirst({
    where: eq(tracks.spotifyUri, spotifyUri),
  });
}
