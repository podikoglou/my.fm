import type { Database } from "../index.ts";
import type { User } from "../schema.ts";

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
