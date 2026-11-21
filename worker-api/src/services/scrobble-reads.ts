import z from "zod";

import type { Database } from "../db/index.ts";

import { countScrobblesByMonth, findRecentScrobblesByUserId } from "../db/queries/scrobbles.ts";
import { isTimeZone } from "../time-zone.ts";
import { getUserByUsername } from "./user-reads.ts";

export const recentScrobblesInput = z.object({
  username: z.string(),

  // we *could* make offset optional but it's just better for the user to remember that this exists
  offset: z.coerce.number(),
  limit: z.coerce.number().max(8).default(8),

  // unix seconds; only scrobbles played before this are returned
  before: z.coerce.number().int().optional(),
});

export const scrobbleMonthsInput = z.object({
  username: z.string(),

  // IANA name, so months start at the viewer's local midnight
  timeZone: z.string().default("UTC").refine(isTimeZone, "Unknown time zone"),
});

export async function getRecentScrobbles(
  db: Database,
  input: z.input<typeof recentScrobblesInput>,
  viewerUserId?: string,
) {
  const { username, offset, limit, before } = recentScrobblesInput.parse(input);
  const user = await getUserByUsername(db, username, viewerUserId);

  if ("error" in user) return { error: user.error, status: user.status };

  const scrobbles = await findRecentScrobblesByUserId(db, user.data.id, {
    before: before === undefined ? undefined : new Date(before * 1000),
    offset,
    limit,
  });

  return { data: scrobbles };
}

export async function getScrobbleMonths(
  db: Database,
  input: z.input<typeof scrobbleMonthsInput>,
  viewerUserId?: string,
) {
  const { username, timeZone } = scrobbleMonthsInput.parse(input);
  const user = await getUserByUsername(db, username, viewerUserId);

  if ("error" in user) return { error: user.error, status: user.status };

  return { data: await countScrobblesByMonth(db, user.data.id, { timeZone }) };
}
