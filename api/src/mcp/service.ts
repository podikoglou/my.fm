import type { CallToolRequest, CallToolResult, Tool } from "@modelcontextprotocol/sdk/types.js";

import { Context, Effect, Layer, Predicate, Result, Schema } from "effect";

import { TimeZoneSchema } from "../api/scrobble.ts";
import { NanoidSchema } from "../api/validators.ts";
import {
  DEFAULT_SAMPLE_SIZE,
  DEFAULT_TOP_LIMIT,
  StatsInputSchemas,
  TimelineBucketSchema,
  TopKindSchema,
} from "../api/stats.ts";
import { RateLimiter } from "../rate-limit/service.ts";
import type { RateLimitBindingName } from "../rate-limits.ts";
import { Scrobbles } from "../scrobbles/service.ts";
import { Stats } from "../stats/service.ts";
import { Users } from "../users/service.ts";

const TOOL_ANNOTATIONS = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
} as const;

const GetMeInputSchema = Schema.Struct({});

const NonEmptyString = Schema.String.check(Schema.isMinLength(1));

const GetUserInputSchema = Schema.Struct({
  username: Schema.optional(NonEmptyString),
  id: Schema.optional(NanoidSchema),
}).check(
  Schema.makeFilter(({ username, id }) => (username === undefined) !== (id === undefined), {
    message: "Provide either username or id",
  }),
);

const GetRecentScrobblesInputSchema = Schema.Struct({
  username: NonEmptyString,
  offset: Schema.Int.check(Schema.isGreaterThanOrEqualTo(0)),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 8 }))),
  before: Schema.optional(Schema.Int.check(Schema.isGreaterThanOrEqualTo(0))),
});

const GetScrobbleMonthsInputSchema = Schema.Struct({
  username: NonEmptyString,
  timeZone: Schema.optional(TimeZoneSchema),
});

const GetPublicFeedInputSchema = Schema.Struct({
  cursor: Schema.optional(Schema.String),
  limit: Schema.optional(Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 50 }))),
});

const StatsRangeFields = {
  since: Schema.optional(StatsInputSchemas.unixSeconds),
  until: Schema.optional(StatsInputSchemas.unixSeconds),
};

const GetSummaryInputSchema = Schema.Struct({
  username: Schema.String,
  ...StatsRangeFields,
});

const GetTopInputSchema = Schema.Struct({
  username: Schema.String,
  kind: TopKindSchema,
  limit: Schema.optional(StatsInputSchemas.topLimit),
  ...StatsRangeFields,
});

const GetTimelineInputSchema = Schema.Struct({
  username: Schema.String,
  bucket: TimelineBucketSchema,
  timeZone: Schema.optional(TimeZoneSchema),
  ...StatsRangeFields,
});

const GetSampleInputSchema = Schema.Struct({
  username: Schema.String,
  size: Schema.optional(StatsInputSchemas.sampleSize),
  seed: Schema.optional(StatsInputSchemas.sampleSeed),
  ...StatsRangeFields,
});

const RANGE_HINT =
  "Optional since/until are Unix seconds bounding the scrobbles considered (until is exclusive).";

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
  {
    name: "get_summary",
    description: `Quick taste profile and library envelope: total scrobbles, first and last play, distinct artists, albums and tracks, and the top five of each. ${RANGE_HINT}`,
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetSummaryInputSchema),
  },
  {
    name: "get_top",
    description: `Ranked artists, albums, or tracks with play count, share of all scrobbles, and first/last seen in the range. An artist is the lead credited artist. limit defaults to 10. ${RANGE_HINT}`,
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetTopInputSchema),
  },
  {
    name: "get_timeline",
    description: `Play counts per day, week (starting Monday), month, or year in a time zone (default UTC), from the first to the last scrobble, with the longest runs of empty buckets as gaps. At most 400 buckets per call. ${RANGE_HINT}`,
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetTimelineInputSchema),
  },
  {
    name: "get_sample",
    description: `Stratified historical sample: splits the history into size (default 20) equal time slices and returns one play from each, so every era is represented. The same seed returns the same sample. ${RANGE_HINT}`,
    annotations: TOOL_ANNOTATIONS,
    inputSchema: toToolInputSchema(GetSampleInputSchema),
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
const decodeGetSummaryInput = Schema.decodeUnknownEffect(GetSummaryInputSchema);
const decodeGetTopInput = Schema.decodeUnknownEffect(GetTopInputSchema);
const decodeGetTimelineInput = Schema.decodeUnknownEffect(GetTimelineInputSchema);
const decodeGetSampleInput = Schema.decodeUnknownEffect(GetSampleInputSchema);

export interface McpServiceApi {
  readonly listTools: () => ReadonlyArray<Tool>;
  readonly callTool: (
    userId: string,
    params: CallToolRequest["params"],
  ) => Effect.Effect<CallToolResult>;
}

export class McpService extends Context.Service<McpService, McpServiceApi>()(
  "@my.fm/api/mcp/McpService",
) {
  static readonly layer: Layer.Layer<McpService, never, Users | Scrobbles | Stats | RateLimiter> =
    Layer.effect(
      McpService,
      Effect.gen(function* () {
        const users = yield* Users;
        const scrobbles = yield* Scrobbles;
        const stats = yield* Stats;
        const rateLimiter = yield* RateLimiter;

        const withPolicy = (
          policy: RateLimitBindingName,
          userId: string,
          run: () => Effect.Effect<CallToolResult>,
        ): Effect.Effect<CallToolResult> =>
          Effect.gen(function* () {
            const allowed = yield* rateLimiter.check(policy, userId).pipe(
              Effect.as(true),
              Effect.catchTag("RateLimitExceededError", () => Effect.succeed(false)),
              Effect.orDie,
            );

            if (!allowed) {
              return toolError("Too many requests");
            }

            return yield* run();
          });

        const withRateLimit = (userId: string, run: () => Effect.Effect<CallToolResult>) =>
          withPolicy("PUBLIC_READ_RATE_LIMIT", userId, run);

        const profileErrors = {
          UserNotFoundError: () => Effect.succeed(toolError("User not found")),
          ProfilePrivateError: () => Effect.succeed(toolError("Profile is private")),
          D1QuotaExceededError: (err: { readonly message: string }) =>
            Effect.succeed(toolError(err.message)),
          D1QueryError: (err: { readonly description: { readonly message: string } }) =>
            Effect.succeed(toolError(err.description.message)),
        };

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
                    : id !== undefined
                      ? users.viewProfileById(id, userId)
                      : undefined;

                if (lookup === undefined) {
                  return Effect.succeed(toolError("Provide either username or id"));
                }

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

            case "get_summary": {
              const decoded = yield* decodeGetSummaryInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              return yield* withRateLimit(userId, () =>
                stats
                  .getSummary(decoded.success, userId)
                  .pipe(Effect.map(toolData), Effect.catchTags(profileErrors)),
              );
            }

            case "get_top": {
              const decoded = yield* decodeGetTopInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              const input = decoded.success;

              return yield* withRateLimit(userId, () =>
                stats
                  .getTop({ ...input, limit: input.limit ?? DEFAULT_TOP_LIMIT }, userId)
                  .pipe(Effect.map(toolData), Effect.catchTags(profileErrors)),
              );
            }

            case "get_timeline": {
              const decoded = yield* decodeGetTimelineInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              const input = decoded.success;

              return yield* withRateLimit(userId, () =>
                stats.getTimeline({ ...input, timeZone: input.timeZone ?? "UTC" }, userId).pipe(
                  Effect.map(toolData),
                  Effect.catchTags({
                    ...profileErrors,
                    TimelineTooLongError: (err) => Effect.succeed(toolError(err.message)),
                  }),
                ),
              );
            }

            case "get_sample": {
              const decoded = yield* decodeGetSampleInput(rawArgs).pipe(Effect.result);

              if (Result.isFailure(decoded)) {
                return toolError(String(decoded.failure));
              }

              const input = decoded.success;

              return yield* withRateLimit(userId, () =>
                stats
                  .getSample(
                    { ...input, size: input.size ?? DEFAULT_SAMPLE_SIZE, seed: input.seed ?? 0 },
                    userId,
                  )
                  .pipe(Effect.map(toolData), Effect.catchTags(profileErrors)),
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
