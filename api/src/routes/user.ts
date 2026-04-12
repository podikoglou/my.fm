import { Hono } from "hono";
import type { Env } from "..";
import { jwtMiddleware, type JwtPayload } from "../jwt";
import {
  findUserById,
  findUserByIdPublic,
  findUserByUsernamePublic,
  onboardUser,
} from "../db/queries/users";
import { zValidator } from "@hono/zod-validator";
import z from "zod";
import { usernameSchema, nameSchema } from "../data/validators";

export default new Hono<Env>()
  .use("/*", jwtMiddleware)
  .get("/me", async (c) => {
    const { id }: JwtPayload = c.get("jwtPayload");
    const user = await findUserById(id);

    return c.json(user ?? { error: "User not found" });
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
      const { username, name } = c.req.valid("form");
      const { id }: JwtPayload = c.get("jwtPayload");

      await onboardUser(id, { username, name });
    },
  );
