import { Hono } from "hono";
import type { Env } from "..";
import { findUserByIdPublic, findUserByUsernamePublic, onboardUser } from "../db/queries/users";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { usernameSchema, nameSchema } from "../data/validators";
import { authMiddleware } from "../auth";

export default new Hono<Env>()
  .use("/*", authMiddleware)
  .get("/me", async (c) => {
    const { id, username, name, email, onboarded } = await c.get("getUserData")();

    return c.json({ id, username, name, email, onboarded }, 200);
  })
  .get("/byUsername", zValidator("query", z.object({ username: z.string() })), async (c) => {
    const { username } = c.req.valid("query");
    const user = await findUserByUsernamePublic(username);

    return user ? c.json(user, 200) : c.json({ error: "User not found" }, 404);
  })
  .get("/byId", zValidator("query", z.object({ id: z.nanoid() })), async (c) => {
    const { id } = c.req.valid("query");
    const user = await findUserByIdPublic(id);

    return user ? c.json(user, 200) : c.json({ error: "User not found" }, 404);
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

      await onboardUser(id, { username, name });
      return c.json({ ok: true }, 200);
    },
  );
