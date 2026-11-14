import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

import type { AppEnv } from "../types.ts";

import { createDatabase } from "../db/index.ts";
import { findPublicFeed, type FeedRow } from "../db/queries/scrobbles.ts";

/**
 * A cursor page never changes when a new scrobble arrives, because new rows
 * sort before the cursor. The first page is the only one that moves.
 */
const FIRST_PAGE_CACHE = "public, max-age=30";
const CURSOR_PAGE_CACHE = "public, max-age=300";

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
  return {
    id: row.id,
    scrobbleDate: row.scrobbleDate,
    user: {
      username: row.user.username,
      name: row.user.name,
      avatarUrl: row.user.avatarUrl,
    },
    track: {
      name: row.track.name,
      imageUrl: row.track.imageUrl,
      spotifyUri: row.track.spotifyUri,
      artists: row.track.trackArtists.map(({ artist }) => ({
        name: artist.name,
        spotifyUri: artist.spotifyUri,
      })),
    },
    album: {
      name: row.album.name,
      spotifyUri: row.album.spotifyUri,
    },
  };
}

export default new Hono<AppEnv>().get(
  "/",
  zValidator(
    "query",
    z.object({
      cursor: z.string().optional(),
      limit: z.coerce.number().int().min(1).max(50).default(20),
    }),
  ),
  async (c) => {
    const { cursor: rawCursor, limit } = c.req.valid("query");
    const cursor = rawCursor === undefined ? undefined : decodeCursor(rawCursor);

    if (rawCursor !== undefined && cursor === undefined) {
      return c.json({ error: "Invalid cursor" }, 400);
    }

    const rows = await findPublicFeed(createDatabase(c.env.DB), { cursor, limit: limit + 1 });
    const page = rows.slice(0, limit);
    const last = page.at(-1);
    const nextCursor = rows.length > limit && last ? encodeCursor(last) : null;

    return c.json(
      {
        items: page.map(toFeedItem),
        nextCursor,
      },
      200,
      { "Cache-Control": cursor ? CURSOR_PAGE_CACHE : FIRST_PAGE_CACHE },
    );
  },
);
