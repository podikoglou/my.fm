import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import auth from "./routes/auth";
import user from "./routes/user";
import type { User } from "./db/schema";
import { cors } from "hono/cors";

export type Env = {
  Variables: JwtVariables & { getUser: () => Promise<User> };
};

const app = new Hono<Env>()
  .use("/*", cors())
  .route("/auth", auth)
  .route("/user", user)
  .onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    return c.json({ error: err.message ?? "Internal server error" }, status);
  });

export type AppType = typeof app;

export default {
  port: 8080,
  fetch: app.fetch,
};
