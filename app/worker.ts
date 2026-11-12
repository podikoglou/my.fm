import type { WebsiteEnv } from "../alchemy.run.ts";

import { isApiPath } from "./api-paths.ts";

export default {
  fetch(request: Request, env: WebsiteEnv) {
    return isApiPath(new URL(request.url).pathname)
      ? env.API.fetch(request)
      : env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<WebsiteEnv>;
