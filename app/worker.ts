import type { WebsiteEnv } from "../alchemy.run.ts";

import { isApiPath } from "./api-paths.ts";

type WorkerEnv = {
  API: Pick<Fetcher, "fetch">;
  ASSETS: Pick<Fetcher, "fetch">;
};

export default {
  fetch(request: Request, env: WorkerEnv) {
    return isApiPath(new URL(request.url).pathname)
      ? env.API.fetch(request)
      : env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WebsiteEnv>;
