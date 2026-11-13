import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

import type { AppEnv } from "../types.ts";

import { sessionMiddleware } from "../auth-middleware.ts";
import { createDatabase } from "../db/index.ts";
import { findRecentScrobblesByUserId } from "../db/queries/scrobbles.ts";
import { canViewProfile, findUserByUsernamePublic } from "../db/queries/users.ts";

export default new Hono<AppEnv>().use("/*", sessionMiddleware).get(
  "/getRecent",
  zValidator(
    "query",
    z.object({
      username: z.string(),

      // we *could* make offset optional but it's just better for the user to remember that this exists
      offset: z.coerce.number(),
      limit: z.coerce.number().max(8).default(8),
    }),
  ),
  async (c) => {
    const { username, offset, limit } = c.req.valid("query");
    const db = createDatabase(c.env.DB);

    const user = await findUserByUsernamePublic(db, username);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    if (!canViewProfile(user, c.get("user")?.id)) {
      return c.json({ error: "Profile is private" }, 403);
    }

    const scrobbles = await findRecentScrobblesByUserId(db, user.id, {
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
);
