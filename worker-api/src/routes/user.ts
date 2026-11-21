import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

import type { AppEnv } from "../types.ts";

import { requireSession, sessionMiddleware } from "../auth-middleware.ts";
import { nameSchema, usernameSchema } from "../data/validators.ts";
import { createDatabase } from "../db/index.ts";
import { onboardUser, updateUserSettings } from "../db/queries/users.ts";
import { rateLimit } from "../rate-limit-middleware.ts";
import { toMeUser, userByUsernameInput, userByIdInput } from "../services/user-reads.ts";
import { viewProfileById, viewProfileByUsername } from "../visibility.ts";

export default new Hono<AppEnv>()
  .use("/byUsername", rateLimit("PUBLIC_READ_RATE_LIMIT"))
  .use("/byId", rateLimit("PUBLIC_READ_RATE_LIMIT"))
  .use("/*", sessionMiddleware)
  .use("/me", requireSession)
  .use("/settings", requireSession)
  .use("/onboard", requireSession)
  .get("/me", async (c) => {
    return c.json(toMeUser(await c.get("getUserData")()), 200);
  })
  .get("/byUsername", zValidator("query", userByUsernameInput), async (c) => {
    const { username } = c.req.valid("query");

    const result = await viewProfileByUsername(
      createDatabase(c.env.DB),
      username,
      c.get("user")?.id,
    );

    if ("error" in result) return c.json({ error: result.error }, result.status);

    return c.json(result.data, 200);
  })
  .get("/byId", zValidator("query", userByIdInput), async (c) => {
    const { id } = c.req.valid("query");
    const result = await viewProfileById(createDatabase(c.env.DB), id, c.get("user")?.id);

    if ("error" in result) return c.json({ error: result.error }, result.status);

    return c.json(result.data, 200);
  })
  .patch("/settings", zValidator("json", z.object({ isPrivate: z.boolean() })), async (c) => {
    const { id } = await c.get("getUserData")();
    const { isPrivate } = c.req.valid("json");

    await updateUserSettings(createDatabase(c.env.DB), id, { isPrivate });

    return c.json({ isPrivate }, 200);
  })
  .put(
    "/onboard",
    zValidator("form", z.object({ username: usernameSchema, name: nameSchema })),
    async (c) => {
      const { id, onboarded } = await c.get("getUserData")();
      const { username, name } = c.req.valid("form");

      if (onboarded) {
        return c.json({ error: "Already onboarded" }, 400);
      }

      await onboardUser(createDatabase(c.env.DB), id, { username, name });

      return c.json({ ok: true }, 200);
    },
  );
