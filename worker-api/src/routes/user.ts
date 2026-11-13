import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

import type { AppEnv } from "../types.ts";

import { requireSession, sessionMiddleware } from "../auth-middleware.ts";
import { nameSchema, usernameSchema } from "../data/validators.ts";
import { createDatabase } from "../db/index.ts";
import {
  canViewProfile,
  findUserByIdPublic,
  findUserByUsernamePublic,
  onboardUser,
  toPublicUser,
  updateUserSettings,
} from "../db/queries/users.ts";

export default new Hono<AppEnv>()
  .use("/*", sessionMiddleware)
  .use("/me", requireSession)
  .use("/settings", requireSession)
  .use("/onboard", requireSession)
  .get("/me", async (c) => {
    const { id, username, name, email, avatarUrl, onboarded, isPrivate } =
      await c.get("getUserData")();

    return c.json({ id, username, name, email, avatarUrl, onboarded, isPrivate }, 200);
  })
  .get("/byUsername", zValidator("query", z.object({ username: z.string() })), async (c) => {
    const { username } = c.req.valid("query");
    const user = await findUserByUsernamePublic(createDatabase(c.env.DB), username);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    if (!canViewProfile(user, c.get("user")?.id)) {
      return c.json({ error: "Profile is private" }, 403);
    }

    return c.json(toPublicUser(user), 200);
  })
  .get("/byId", zValidator("query", z.object({ id: z.nanoid() })), async (c) => {
    const { id } = c.req.valid("query");
    const user = await findUserByIdPublic(createDatabase(c.env.DB), id);

    if (!user) {
      return c.json({ error: "User not found" }, 404);
    }

    if (!canViewProfile(user, c.get("user")?.id)) {
      return c.json({ error: "Profile is private" }, 403);
    }

    return c.json(toPublicUser(user), 200);
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
