import { Hono } from "hono";

import type { AppEnv } from "../types.ts";

import { requireSession, sessionMiddleware } from "../auth-middleware.ts";
import { createDatabase } from "../db/index.ts";
import {
  acknowledgeNotification,
  findUnacknowledgedNotifications,
} from "../db/queries/notifications.ts";
import { syncSpotifyReauthNotification } from "../notifications/spotify-reauth.ts";

export default new Hono<AppEnv>()
  .use("/*", sessionMiddleware)
  .use("/*", requireSession)
  .get("/", async (c) => {
    const { id } = await c.get("getUserData")();
    const db = createDatabase(c.env.DB);

    await syncSpotifyReauthNotification(db, id);

    const notifications = await findUnacknowledgedNotifications(db, id);

    return c.json({ notifications }, 200);
  })
  .post("/:id/acknowledge", async (c) => {
    const { id: userId } = await c.get("getUserData")();
    const db = createDatabase(c.env.DB);

    if (!(await acknowledgeNotification(db, userId, c.req.param("id")))) {
      return c.json({ error: "Notification not found" }, 404);
    }

    return c.json({ ok: true }, 200);
  });
