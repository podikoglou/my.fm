import type { WorkerEnv } from "../alchemy.run.ts";

import { createApp } from "./app.ts";

const app = createApp();

export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
} satisfies ExportedHandler<WorkerEnv>;
