import type { D1Migration } from "cloudflare:test";

import type { WorkerEnv } from "../src/alchemy.ts";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerEnv {
      TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      mainModule: typeof import("../src/worker.ts");
    }
  }
}
