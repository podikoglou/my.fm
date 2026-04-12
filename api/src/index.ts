import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";
import auth from "./routes/auth";
import user from "./routes/user";

export type Env = {
  Variables: JwtVariables;
};

const app = new Hono<Env>().route("/auth", auth).route("/user", user);

export type AppType = typeof app;
