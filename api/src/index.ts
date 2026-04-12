import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";
import auth from "./routes/auth";
import user from "./routes/user";
import type { User } from "./db/schema";
import { cors } from "hono/cors";

export type Env = {
  Variables: JwtVariables & { getUser: () => Promise<User> };
};

const app = new Hono<Env>().use("/*", cors()).route("/auth", auth).route("/user", user);

export type AppType = typeof app;

export default {
  port: 8080,
  fetch: app.fetch,
};
