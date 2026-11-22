import type { CallToolRequest, CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { Context, Effect, Layer, Predicate, Result, Schema } from "effect";

import { TimeZoneSchema } from "../api/scrobble.ts";
import { NanoidSchema } from "../api/validators.ts";
import { RateLimiter } from "../rate-limit/service.ts";
import { Scrobbles } from "../scrobbles/service.ts";
import { Users } from "../users/service.ts";

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const GetMeInputSchema = Schema.Struct({});

const GetUserInputSchema = Schema.Struct({
  username: Schema.optional(Schema.String),
  id: Schema.optional(NanoidSchema),
}).check(
  Schema.makeFilter(({ username, id }) => (username === undefined) !== (id === undefined), {
    message: "Provide either username or id",
  }),
);

const GetRecentScrobblesInputSchema = Schema.Struct({
  username: Schema.String,
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }))),
  before: Schema.optional(Schema.Number),
});

const GetScrobbleMonthsInputSchema = Schema.Struct({
  username: Schema.String,
  timeZone: Schema.optional(TimeZoneSchema),
});

const GetPublicFeedInputSchema = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});

function toToolInputSchema(schema: Schema.Top): Tool["inputSchema"] {
  const doc = Schema.toJsonSchemaDocument(schema);
  const root = doc.schema;
  const inputSchema: Tool["inputSchema"] = { type: "object" };

  if (Predicate.isObject(root)) {
    Object.assign(inputSchema, root, { type: "object" });
  }

  return inputSchema;
}

const MCP_TOOLS: ReadonlyArray<Tool> = [
  {
    name: "get_me",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetMeInputSchema),
  },
  {
    name: "get_user",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetUserInputSchema),
  },
  {
    name: "get_recent_scrobbles",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetRecentScrobblesInputSchema),
  },
  {
    name: "get_scrobble_months",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetScrobbleMonthsInputSchema),
  },
  {
    name: "get_public_feed",
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetPublicFeedInputSchema),
  },
];

function toolError(message: string): CallToolResult {
  return { isError: true, content: [{ type: "text", text: message }] };
}

function toolData<T>(data: T): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

const decodeGetMeInput = Schema.decodeUnknownEffect(GetMeInputSchema);
const decodeGetUserInput = Schema.decodeUnknownEffect(GetUserInputSchema);
const decodeGetRecentScrobblesInput = Schema.decodeUnknownEffect(GetRecentScrobblesInputSchema);
const decodeGetScrobbleMonthsInput = Schema.decodeUnknownEffect(GetScrobbleMonthsInputSchema);
const decodeGetPublicFeedInput = Schema.decodeUnknownEffect(GetPublicFeedInputSchema);

export interface McpServiceApi {
  readonly listTools: () => ReadonlyArray<Tool>;
  readonly callTool: (
    userId: string,
    params: CallToolRequest["params"],
  ) => Effect.Effect<CallToolResult>;
}

export class McpService extends Context.Service<McpService, McpServiceApi>()(
  "@my.fm/effect-api/mcp/McpService",
) {
  static readonly layer: Layer.Layer<McpService, never, Users | Scrobbles | RateLimiter> =
    Layer.effect(
      McpService,
      Effect.gen(function* () {
        const users = yield* Users;
        const scrobbles = yield* Scrobbles;
        const rateLimiter = yield* RateLimiter;

        const withRateLimit = (
          userId: string,
          run: () => Effect.Effect<CallToolResult>,
        ): Effect.Effect<CallToolResult> =>
          Effect.gen(function* () {
            const allowed = yield* rateLimiter.check("PUBLIC_READ_RATE_LIMIT", userId).pipe(
              Effect.as(true),
              Effect.catchTag("RateLimitExceededError", () => Effect.succeed(false)),
              Effect.orDie,
            );

            if (!allowed) {
              return toolError("Too many requests");
            }

            return yield* run();
          });

        const callTool = Effect.fn("McpService.callTool")(function* (
          userId: string,
          params: CallToolRequest["params"],
        ): Effect.fn.Return<CallToolResult> {
          const { name } = params;
          const rawArgs = params.arguments ?? {};

          switch (name) {
            case "get_me": {
              const decoded = yield* decodeGetMeInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              return yield* withRateLimit(userId, () =>
                users.getMeForMcp(userId).pipe(
                  Effect.map(toolData),
                  Effect.catchTags({
                    UserNotFoundError: () => Effect.succeed(toolError("User not found")),
                    D1QuotaExceededError: (err) => Effect.succeed(toolError(err.message)),
                    D1QueryError: (err) => Effect.succeed(toolError(err.description.message)),
                  }),
                ),
              );
            }

            case "get_user": {
              const decoded = yield* decodeGetUserInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              const { username, id } = decoded.success;

              return yield* withRateLimit(userId, () => {
                const lookup =
                  username !== undefined
                    ? users.viewProfileByUsername(username, userId)
                    : users.viewProfileById(id ?? "", userId);

                return lookup.pipe(
                  Effect.map(({ avatarUrl: _, ...user }) => toolData(user)),
                  Effect.catchTags({
                    UserNotFoundError: () => Effect.succeed(toolError("User not found")),
                    ProfilePrivateError: () => Effect.succeed(toolError("Profile is private")),
                    D1QuotaExceededError: (err) => Effect.succeed(toolError(err.message)),
                    D1QueryError: (err) => Effect.succeed(toolError(err.description.message)),
                  }),
                );
              });
            }

            case "get_recent_scrobbles": {
              const decoded = yield* decodeGetRecentScrobblesInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              const input = decoded.success;

              return yield* withRateLimit(userId, () =>
                scrobbles
                  .getRecent(
                    {
                      username: input.username,
                      offset: input.offset,
                      limit: input.limit ?? 8,
                      before: input.before,
                    },
                    userId,
                  )
                  .pipe(
                    Effect.map(toolData),
                    Effect.catchTags({
                      UserNotFoundError: () => Effect.succeed(toolError("User not found")),
                      ProfilePrivateError: () => Effect.succeed(toolError("Profile is private")),
                      D1QuotaExceededError: (err) => Effect.succeed(toolError(err.message)),
                      D1QueryError: (err) => Effect.succeed(toolError(err.description.message)),
                    }),
                  ),
              );
            }

            case "get_scrobble_months": {
              const decoded = yield* decodeGetScrobbleMonthsInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              const input = decoded.success;

              return yield* withRateLimit(userId, () =>
                scrobbles
                  .getMonths(
                    {
                      username: input.username,
                      timeZone: input.timeZone ?? "UTC",
                    },
                    userId,
                  )
                  .pipe(
                    Effect.map(toolData),
                    Effect.catchTags({
                      UserNotFoundError: () => Effect.succeed(toolError("User not found")),
                      ProfilePrivateError: () => Effect.succeed(toolError("Profile is private")),
                      D1QuotaExceededError: (err) => Effect.succeed(toolError(err.message)),
                      D1QueryError: (err) => Effect.succeed(toolError(err.description.message)),
                    }),
                  ),
              );
            }

            case "get_public_feed": {
              const decoded = yield* decodeGetPublicFeedInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              const input = decoded.success;

              return yield* withRateLimit(userId, () =>
                scrobbles
                  .getPublicFeed({
                    cursor: input.cursor,
                    limit: input.limit ?? 20,
                  })
                  .pipe(
                    Effect.map((page) =>
                      toolData({
                        ...page,
                        items: page.items.map((item) => {
                          const { avatarUrl: _, ...user } = item.user;

                          return { ...item, user };
                        }),
                      }),
                    ),
                    Effect.catchTags({
                      InvalidCursorError: () => Effect.succeed(toolError("Invalid cursor")),
                      D1QuotaExceededError: (err) => Effect.succeed(toolError(err.message)),
                      D1QueryError: (err) => Effect.succeed(toolError(err.description.message)),
                    }),
                  ),
              );
            }

            default:
              return toolError(`Unknown tool: ${name}`);
          }
        });

        return McpService.of({
          listTools: () => MCP_TOOLS,
          callTool,
        });
      }),
    );
}
