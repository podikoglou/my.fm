import type { D1Migration } from "cloudflare:test";

import type { WorkerBindings } from "../src/worker.ts";

declare global {
  namespace Cloudflare {
    interface Env extends WorkerBindings {
      TEST_MIGRATIONS: D1Migration[];
    }

    interface GlobalProps {
      mainModule: typeof import("../src/worker.ts");
    }
  }
}
