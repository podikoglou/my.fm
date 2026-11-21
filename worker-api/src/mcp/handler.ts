import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import z from "zod";

import type { WorkerEnv } from "../alchemy.ts";

import { createMcpServer } from "./server.ts";

const oauthProps = z.object({ userId: z.string().min(1) });

export const mcpApiHandler = {
  async fetch(request: Request, env: WorkerEnv, ctx: ExecutionContext) {
    if (request.method !== "POST") {
      return new Response(null, { status: 405, headers: { Allow: "POST" } });
    }

    const { userId } = oauthProps.parse(ctx.props);

    const server = createMcpServer(env, userId);

    const transport = new WebStandardStreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    await server.connect(transport);

    try {
      return await transport.handleRequest(request);
    } finally {
      await server.close();
    }
  },
};
