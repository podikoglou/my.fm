import { OAuthProvider } from "@cloudflare/workers-oauth-provider";

import type { WorkerEnv } from "./alchemy.ts";

import { createApp } from "./app.ts";
import { runImportTick } from "./import/run.ts";
import { runIngestion } from "./ingestion/run.ts";
import { mcpApiHandler } from "./mcp/handler.ts";
import { RATE_LIMITS } from "./rate-limits.ts";

const app = createApp();

export default {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    const { pathname } = new URL(request.url);

    if (request.method === "POST" && (pathname === "/register" || pathname === "/token")) {
      const key = request.headers.get("cf-connecting-ip") ?? "unknown";
      const { success } = await env.AUTH_RATE_LIMIT.limit({ key });

      if (!success) {
        return Response.json(
          { error: "Too many requests" },
          {
            status: 429,
            headers: {
              "Retry-After": String(RATE_LIMITS.AUTH_RATE_LIMIT.period),
              "Cache-Control": "private, no-store",
            },
          },
        );
      }
    }

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

    return provider.fetch(request, { ...env }, ctx);
  },
  async scheduled(controller: ScheduledController, env: WorkerEnv, _ctx: ExecutionContext) {
    await runIngestion(env, undefined, new Date(controller.scheduledTime));
    await runImportTick(env);
  },
} satisfies ExportedHandler<WorkerEnv>;
