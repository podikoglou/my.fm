import { Hono } from "hono";
import type { Env } from "..";
import { jwtMiddleware, type JwtPayload } from "../jwt";
import { findUserById, findUserByUsername } from "../db/queries/users";
import { zValidator } from "@hono/zod-validator";
import z from "zod";

export default new Hono<Env>()
  .use("/*", jwtMiddleware)
  .get("/me", async (c) => {
    const { id }: JwtPayload = c.get("jwtPayload");
    const user = await findUserById(id);

    return c.json(user ?? { error: "User not found" });
  })
  .get("/byUsername", zValidator("form", z.object({ username: z.string() })), async (c) => {
    const { username } = c.req.valid("form");
    const user = await findUserByUsername(username);

    return c.json(user ?? { error: "User not found" });
  });
