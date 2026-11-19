import type { WorkerEnv } from "./alchemy.ts";

import { createApp } from "./app.ts";
import { runIngestion } from "./ingestion/run.ts";

const app = createApp();

export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    return app.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: WorkerEnv, _ctx: ExecutionContext) {
    await runIngestion(env, undefined, new Date(controller.scheduledTime));
  },
} satisfies ExportedHandler<WorkerEnv>;
