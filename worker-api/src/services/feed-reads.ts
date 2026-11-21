import z from "zod";

import type { Database } from "../db/index.ts";

import { findPublicFeed, type FeedRow } from "../db/queries/scrobbles.ts";
import { unlinkedAlbum, unlinkedTrack } from "../import/unlinked.ts";

const CURSOR_VERSION = 1;

const cursorPayload = z.tuple([
  z.literal(CURSOR_VERSION),
  z.number().int().nonnegative(),
  z.string().regex(/^[0-9a-f]{32}$/),
]);

function encodeCursor(row: FeedRow) {
  if (!row.scrobbleDate) return null;

  const seconds = Math.floor(row.scrobbleDate.getTime() / 1000);
  const bytes = btoa(JSON.stringify([CURSOR_VERSION, seconds, row.id]));

  return bytes.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(value: string) {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed = cursorPayload.parse(JSON.parse(atob(padded)));

    return { scrobbleDate: new Date(parsed[1] * 1000), id: parsed[2] };
  } catch {
    return undefined;
  }
}

function toFeedItem(row: FeedRow) {
  const track = row.track
    ? {
        name: row.track.name,
        imageUrl: row.track.imageUrl,
        spotifyUri: row.track.spotifyUri,
        artists: row.track.trackArtists.map(({ artist }) => ({
          name: artist.name,
          spotifyUri: artist.spotifyUri,
        })),
      }
    : unlinkedTrack(row);

  const { name, spotifyUri } = row.album ?? unlinkedAlbum(row);

  return {
    id: row.id,
    scrobbleDate: row.scrobbleDate,
    user: {
      username: row.user.username,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl,
    },
    track,
    album: { name, spotifyUri },
  };
}

export const publicFeedInput = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export async function getPublicFeed(db: Database, input: z.input<typeof publicFeedInput>) {
  const { cursor: rawCursor, limit } = publicFeedInput.parse(input);

  const cursor = rawCursor === undefined ? undefined : decodeCursor(rawCursor);

  if (rawCursor !== undefined && cursor === undefined) {
    return { error: "Invalid cursor", status: 400 } as const;
  }

  const rows = await findPublicFeed(db, { cursor, limit: limit + 1 });
  const page = rows.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = rows.length > limit && last ? encodeCursor(last) : null;

  return { data: { items: page.map(toFeedItem), nextCursor } };
}
