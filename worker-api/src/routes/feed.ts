import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";

import type { AppEnv } from "../types.ts";

import { createDatabase } from "../db/index.ts";
import { rateLimit } from "../rate-limit-middleware.ts";
import { getPublicFeed, publicFeedInput } from "../services/feed-reads.ts";

const FIRST_PAGE_CACHE = "public, max-age=30";
const CURSOR_PAGE_CACHE = "public, max-age=300";

export default new Hono<AppEnv>()
  .use("*", rateLimit("PUBLIC_READ_RATE_LIMIT"))
  .get("/", zValidator("query", publicFeedInput), async (c) => {
    const input = c.req.valid("query");
    const result = await getPublicFeed(createDatabase(c.env.DB), input);

    if ("error" in result) return c.json({ error: result.error }, result.status);

    return c.json(result.data, 200, {
      "Cache-Control": input.cursor ? CURSOR_PAGE_CACHE : FIRST_PAGE_CACHE,
    });
  });
