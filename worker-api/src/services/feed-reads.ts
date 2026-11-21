import z from "zod";

import type { Database } from "../db/index.ts";

import { findPublicFeed, type FeedCursor, type FeedItem } from "../db/queries/scrobbles.ts";

const CURSOR_VERSION = 1;

const cursorPayload = z.tuple([
  z.literal(CURSOR_VERSION),
  z.number().int().nonnegative(),
  z.string().regex(/^[0-9a-f]{32}$/),
]);

function encodeCursor(row: Pick<FeedItem, "id" | "scrobbleDate">) {
  const seconds = Math.floor(row.scrobbleDate.getTime() / 1000);
  const bytes = btoa(JSON.stringify([CURSOR_VERSION, seconds, row.id]));

  return bytes.replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decodeCursor(value: string): FeedCursor | undefined {
  try {
    const base64 = value.replaceAll("-", "+").replaceAll("_", "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const parsed = cursorPayload.parse(JSON.parse(atob(padded)));

    return { scrobbleDate: new Date(parsed[1] * 1000), id: parsed[2] };
  } catch {
    return undefined;
  }
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

  const items = await findPublicFeed(db, { cursor, limit: limit + 1 });
  const page = items.slice(0, limit);
  const last = page.at(-1);
  const nextCursor = items.length > limit && last ? encodeCursor(last) : null;

  return { data: { items: page, nextCursor } };
}
