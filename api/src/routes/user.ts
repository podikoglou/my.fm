import { Hono } from "hono";
import type { Env } from "..";
import { jwtMiddleware, type JwtPayload } from "../jwt";
import { findUserById } from "../db/queries/users";

export default new Hono<Env>().use("/*", jwtMiddleware).get("/me", async (c) => {
  const { id }: JwtPayload = c.get("jwtPayload");
  const user = await findUserById(id);

  return c.json(user ?? { error: "User not found" });
});
