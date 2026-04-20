import { Hono } from "hono";
import { HTTPException } from "hono/http-exception";
import { httpLogger } from "./logger";
import { auth } from "./auth";
import { env } from "./env";
import user from "./routes/user";
import { cors } from "hono/cors";
import { seedFetchQueue } from "./scheduler/queue";
import { setupScheduler } from "./scheduler/scheduler";
import scrobble from "./routes/scrobble";
import type { User } from "./db/schema";

export type Env = {
  Variables: {
    user: typeof auth.$Infer.Session.user | null;
    session: typeof auth.$Infer.Session.session | null;
    getUserData: () => Promise<User>;
  };
};

await seedFetchQueue();
setupScheduler();

const app = new Hono<Env>()
  .use(httpLogger)
  .use("/*", cors({ origin: env.FRONTEND_URL, credentials: true }))
  .on(["POST", "GET"], "/api/auth/*", (c) => {
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
