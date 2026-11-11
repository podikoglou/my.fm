import type { WorkerEnv } from "./alchemy.ts";
import type { Auth } from "./auth.ts";
import type { User } from "./db/schema.ts";

type Session = Auth["$Infer"]["Session"];

/**
 * The Hono environment for the Worker API.
 *
 * `Bindings` exposes the Worker environment. `Variables` holds the values the
 * auth middleware puts on the request context, mirroring the Bun API.
 */
export type AppEnv = {
  Bindings: WorkerEnv;
  Variables: {
    user: Session["user"] | null;
    session: Session["session"] | null;
    getUserData: () => Promise<User>;
  };
};
