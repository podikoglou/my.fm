import { Hono } from "hono";
import { jwt } from "hono/jwt";
import type { JwtVariables } from "hono/jwt";
import { env } from "./env";

type Env = {
  Variables: JwtVariables;
};

const jwtMiddleware = jwt({
  secret: env.SECRET,
  alg: "HS256",
});

const testApp = new Hono<Env>()
  .use(jwtMiddleware)
  .get("/", (c) => c.json(c.var) /* <-- this is supposed to test auth */);

const app = new Hono<Env>().route("/test", testApp);

export type AppType = typeof app;
