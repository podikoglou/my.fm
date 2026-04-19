import { Hono } from "hono";
import type { JwtVariables } from "hono/jwt";
import { HTTPException } from "hono/http-exception";
import { httpLogger } from "./logger";
import { auth } from "./auth";
import user from "./routes/user";
import type { User } from "./db/schema";
import { cors } from "hono/cors";
import { seedFetchQueue } from "./scheduler/queue";
import { setupScheduler } from "./scheduler/scheduler";
import scrobble from "./routes/scrobble";

export type Env = {
  Variables: JwtVariables & { getUser: () => Promise<User> };
};

await seedFetchQueue();
setupScheduler();

const app = new Hono<Env>()
  .use(httpLogger)
  .use("/*", cors())
  .on(["POST", "GET"], "/auth/*", (c) => {
    return auth.handler(c.req.raw);
  })
  .route("/user", user)
  .route("/scrobble", scrobble)
  .onError((err, c) => {
    const status = err instanceof HTTPException ? err.status : 500;
    return c.json({ error: err.message ?? "Internal server error" }, status);
  });

export type AppType = typeof app;

export default {
  port: 8080,
  fetch: app.fetch,
};
