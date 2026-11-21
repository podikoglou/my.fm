import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import type { WorkerEnv } from "./alchemy.ts";

import { createApp } from "./app.ts";
import { runImportIngestion } from "./ingestion/import.ts";
import { runIngestion } from "./ingestion/run.ts";
import { mcpApiHandler } from "./mcp/handler.ts";

const app = createApp();

export default {
  fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    const provider = new OAuthProvider<WorkerEnv>({
      apiRoute: "/mcp",
      apiHandler: mcpApiHandler,
      defaultHandler: app,
      authorizeEndpoint: "/oauth/authorize",
      tokenEndpoint: "/token",
      clientRegistrationEndpoint: "/register",
      scopesSupported: ["read"],
      requiredScopes: ["read"],
      clientIdMetadataDocumentEnabled: true,
      resourceMetadata: { resource: new URL("/mcp", request.url).href },
    });

    return provider.fetch(request, env, ctx);
  },
  async scheduled(controller: ScheduledController, env: WorkerEnv, _ctx: ExecutionContext) {
    await runIngestion(env, undefined, new Date(controller.scheduledTime));
    await runImportIngestion(env);
  },
} satisfies ExportedHandler<WorkerEnv>;
