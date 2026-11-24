import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { Effect, Layer } from "effect";

import type { AppServices } from "../http/app.ts";

import { Scrobbles } from "../scrobbles/service.ts";
import { Users } from "../users/service.ts";
import { McpService } from "./service.ts";

const McpDomainLayer = McpService.layer.pipe(
  Layer.provideMerge(Scrobbles.layer),
  Layer.provideMerge(Users.layer),
);

export async function handleMcpRequest(
  request: Request,
  userId: string,
  infraLayer: Layer.Layer<AppServices>,
): Promise<Response> {
  if (request.method !== "POST") {
    return new Response(null, { status: 405, headers: { Allow: "POST" } });
  }

  const fullLayer = McpDomainLayer.pipe(Layer.provide(infraLayer));

  const server = new Server({ name: "my.fm", version: "1.0.0" }, { capabilities: { tools: {} } });

  server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = await Effect.runPromise(
      Effect.gen(function* () {
        const mcp = yield* McpService;

        return mcp.listTools();
      }).pipe(Effect.provide(fullLayer)),
    );

    return { tools: [...tools] };
  });

  server.setRequestHandler(CallToolRequestSchema, async (req) =>
    Effect.runPromise(
      Effect.gen(function* () {
        const mcp = yield* McpService;

        return yield* mcp.callTool(userId, req.params);
      }).pipe(Effect.provide(fullLayer)),
    ),
  );

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
}
