import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import type { AppEnv } from "../types.ts";

import { sessionMiddleware } from "../auth-middleware.ts";
import { createDatabase } from "../db/index.ts";
import { rateLimit } from "../rate-limit-middleware.ts";
import {
  getRecentScrobbles,
  getScrobbleMonths,
  recentScrobblesInput,
  scrobbleMonthsInput,
} from "../services/scrobble-reads.ts";

export default new Hono<AppEnv>()
  .use("/getRecent", rateLimit("PUBLIC_READ_RATE_LIMIT"))
  .use("/getMonths", rateLimit("PUBLIC_READ_RATE_LIMIT"))
  .use("/*", sessionMiddleware)
  .get("/getRecent", zValidator("query", recentScrobblesInput), async (c) => {
    const result = await getRecentScrobbles(
      createDatabase(c.env.DB),
      c.req.valid("query"),
      c.get("user")?.id,
    );

    if ("error" in result) return c.json({ error: result.error }, result.status);

    return c.json(result.data, 200);
  })
  .get("/getMonths", zValidator("query", scrobbleMonthsInput), async (c) => {
    const result = await getScrobbleMonths(
      createDatabase(c.env.DB),
      c.req.valid("query"),
      c.get("user")?.id,
    );

    if ("error" in result) return c.json({ error: result.error }, result.status);

    return c.json(result.data, 200);
  });
