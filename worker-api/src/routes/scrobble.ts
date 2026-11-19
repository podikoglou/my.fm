import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

import type { AppEnv } from "../types.ts";

import { sessionMiddleware } from "../auth-middleware.ts";
import { createDatabase } from "../db/index.ts";
import { countScrobblesByMonth, findRecentScrobblesByUserId } from "../db/queries/scrobbles.ts";
import { canViewProfile, findUserByUsernamePublic } from "../db/queries/users.ts";
import { rateLimit } from "../rate-limit-middleware.ts";

export default new Hono<AppEnv>()
  .use("/getRecent", rateLimit("PUBLIC_READ_RATE_LIMIT"))
  .use("/getMonths", rateLimit("PUBLIC_READ_RATE_LIMIT"))
  .use("/*", sessionMiddleware)
  .get(
    "/getRecent",
    zValidator(
      "query",
      z.object({
        username: z.string(),

        // we *could* make offset optional but it's just better for the user to remember that this exists
        offset: z.coerce.number(),
        limit: z.coerce.number().max(8).default(8),

        // unix seconds; only scrobbles played before this are returned
        before: z.coerce.number().int().optional(),
      }),
    ),
    async (c) => {
      const { username, offset, limit, before } = c.req.valid("query");
      const db = createDatabase(c.env.DB);

      const user = await findUserByUsernamePublic(db, username);

      if (!user) {
        return c.json({ error: "User not found" }, 404);
      }

      if (!canViewProfile(user, c.get("user")?.id)) {
        return c.json({ error: "Profile is private" }, 403);
      }

      const scrobbles = await findRecentScrobblesByUserId(db, user.id, {
        before: before === undefined ? undefined : new Date(before * 1000),
        offset,
        limit,
      });

      return c.json(
        scrobbles.map(({ id, track, album, scrobbleDate }) => {
          // track artists
          const trackArtists = track.trackArtists
            .map((artist) => ({
              ...artist.artist,
              position: artist.position,
            }))
            .sort((a, b) => a.position - b.position)
            .map(({ position: _, ...rest }) => rest);

          // album artists
          const albumArtists = album.albumArtists
            .map((artist) => ({
              ...artist.artist,
              position: artist.position,
            }))
            .sort((a, b) => a.position - b.position)
            .map(({ position: _, ...rest }) => rest);

          return {
            id,
            track: {
              ...track,
              trackArtists: undefined, // this is set by the drizzle query, it's just a bad name so we're using 'artists' instead
              artists: trackArtists,
            },
            album: {
              ...album,
              albumArtists: undefined,
              artists: albumArtists,
            },
            scrobbleDate,
          };
        }),
        200,
      );
    },
  )
  .get(
    "/getMonths",
    zValidator(
      "query",
      z.object({
        username: z.string(),

        // IANA name, so months start at the viewer's local midnight
        timeZone: z
          .string()
          .default("UTC")
          .refine((timeZone) => {
            try {
              new Intl.DateTimeFormat("en-US", { timeZone });

              return true;
            } catch {
              return false;
            }
          }, "Unknown time zone"),
      }),
    ),
    async (c) => {
      const { username, timeZone } = c.req.valid("query");
      const db = createDatabase(c.env.DB);

      const user = await findUserByUsernamePublic(db, username);

      if (!user) {
        return c.json({ error: "User not found" }, 404);
      }

      if (!canViewProfile(user, c.get("user")?.id)) {
        return c.json({ error: "Profile is private" }, 403);
      }

      const months = await countScrobblesByMonth(db, user.id, { timeZone });

      return c.json(months, 200);
    },
  );
