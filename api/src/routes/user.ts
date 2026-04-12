import { Hono } from "hono";
import type { Env } from "..";
import { findUserByIdPublic, findUserByUsernamePublic, onboardUser } from "../db/queries/users";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { usernameSchema, nameSchema } from "../data/validators";
import { authMiddleware } from "../auth/middleware";

export default new Hono<Env>()
  .use("/*", authMiddleware)
  .get("/me", async (c) => {
    const { id, username, name, email, onboarded } = await c.get("getUser")();

    return c.json({ id, username, name, email, onboarded });
  })
  .get("/byUsername", zValidator("form", z.object({ username: z.string() })), async (c) => {
    const { username } = c.req.valid("form");
    const user = await findUserByUsernamePublic(username);

    return c.json(user ?? { error: "User not found" });
  })
  .get("/byId", zValidator("form", z.object({ id: z.nanoid() })), async (c) => {
    const { id } = c.req.valid("form");
    const user = await findUserByIdPublic(id);

    return c.json(user ?? { error: "User not found" });
  })
  .put(
    "/onboard",
    zValidator("form", z.object({ username: usernameSchema, name: nameSchema })),
    async (c) => {
      const { id } = await c.get("getUser")();
      const { username, name } = c.req.valid("form");

      await onboardUser(id, { username, name });
    },
  );
