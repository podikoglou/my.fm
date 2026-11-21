import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import z from "zod";

import type { WorkerEnv } from "../alchemy.ts";

import { createDatabase } from "../db/index.ts";
import { getPublicFeed, publicFeedInput } from "../services/feed-reads.ts";
import {
  getRecentScrobbles,
  getScrobbleMonths,
  recentScrobblesInput,
  scrobbleMonthsInput,
} from "../services/scrobble-reads.ts";
import {
  getMeForMcp,
  getUserById,
  getUserByUsername,
  toMcpPublicUser,
} from "../services/user-reads.ts";

const annotations = { readOnlyHint: true, destructiveHint: false, idempotentHint: true };

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function toolData<T>(data: T): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function createMcpServer(env: WorkerEnv, userId: string) {
  const server = new McpServer({ name: "my.fm", version: "1.0.0" });
  const db = createDatabase(env.DB);

  const limited = async (read: () => Promise<CallToolResult>) => {
    const { success } = await env.PUBLIC_READ_RATE_LIMIT.limit({ key: userId });

    if (!success) return toolError("Too many requests");

    return read();
  };

  server.registerTool("get_me", { annotations, inputSchema: z.object({}) }, () =>
    limited(async () => {
      const result = await getMeForMcp(db, userId);

      return result.error !== undefined ? toolError(result.error) : toolData(result.data);
    }),
  );
  server.registerTool(
    "get_user",
    {
      annotations,
      inputSchema: z
        .object({ username: z.string().optional(), id: z.nanoid().optional() })
        .refine(
          ({ username, id }) => (username === undefined) !== (id === undefined),
          "Provide either username or id",
        ),
    },
    ({ username, id }) =>
      limited(async () => {
        const result =
          username !== undefined
            ? await getUserByUsername(db, username, userId)
            : await getUserById(db, id ?? "", userId);

        return result.error !== undefined
          ? toolError(result.error)
          : toolData(toMcpPublicUser(result.data));
      }),
  );
  server.registerTool(
    "get_recent_scrobbles",
    { annotations, inputSchema: recentScrobblesInput },
    (input) =>
      limited(async () => {
        const result = await getRecentScrobbles(db, input, userId);

        return result.error !== undefined ? toolError(result.error) : toolData(result.data);
      }),
  );
  server.registerTool(
    "get_scrobble_months",
    { annotations, inputSchema: scrobbleMonthsInput },
    (input) =>
      limited(async () => {
        const result = await getScrobbleMonths(db, input, userId);

        return result.error !== undefined ? toolError(result.error) : toolData(result.data);
      }),
  );
  server.registerTool("get_public_feed", { annotations, inputSchema: publicFeedInput }, (input) =>
    limited(async () => {
      const result = await getPublicFeed(db, input);

      if (result.error !== undefined) return toolError(result.error);

      return toolData({
        ...result.data,
        items: result.data.items.map((item) => {
          const { avatarUrl: _, ...user } = item.user;

          return { ...item, user };
        }),
      });
    }),
  );

  return server;
}
