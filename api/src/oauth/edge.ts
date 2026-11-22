import type { ExecutionContext, KVNamespace } from "@cloudflare/workers-types";

import type { OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Effect, type Layer, Schema } from "effect";

import { type AppServices, handleWebRequest } from "../http/app.ts";
import { handleMcpRequest } from "../mcp/handler.ts";
import { RateLimiter } from "../rate-limit/service.ts";
import { RATE_LIMITS } from "../rate-limits.ts";
import { OAuthProviderService } from "./service.ts";

interface OAuthEdgeEnv {
  readonly OAUTH_KV: KVNamespace;
  readonly OAUTH_PROVIDER?: OAuthHelpers;
}

const OAuthPropsSchema = Schema.Struct({
  userId: Schema.String.check(Schema.isMinLength(1)),
});

const decodeOAuthProps = Schema.decodeUnknownSync(OAuthPropsSchema);

/**
 * Wrap the Effect HTTP app and MCP handler behind Cloudflare's
 * `@cloudflare/workers-oauth-provider` edge, enforcing `AUTH_RATE_LIMIT` on
 * `POST /register` and `POST /token`.
 */
export async function handleOAuthEdgeRequest(
  request: Request,
  oauthKv: KVNamespace,
  ctx: ExecutionContext,
  infraLayer: Layer.Layer<AppServices>,
): Promise<Response> {
  const { pathname } = new URL(request.url);

  if (request.method === "POST" && (pathname === "/register" || pathname === "/token")) {
    const key = request.headers.get("cf-connecting-ip") ?? "unknown";

    const allowed = await Effect.runPromise(
      Effect.gen(function* () {
        const rateLimiter = yield* RateLimiter;

        return yield* rateLimiter.check("AUTH_RATE_LIMIT", key).pipe(
          Effect.as(true),
          Effect.catchTag("RateLimitExceededError", () => Effect.succeed(false)),
          Effect.orDie,
        );
      }).pipe(Effect.provide(infraLayer)),
    );

    if (!allowed) {
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

  // The package imports `cloudflare:workers` (a workerd-only builtin), which
  // Bun cannot resolve. A static import would break the deploy CLI, which
  // imports the stack — and this module through it — outside workerd.
  const { OAuthProvider } = await import("@cloudflare/workers-oauth-provider");

  const provider = new OAuthProvider<OAuthEdgeEnv>({
    apiRoute: "/mcp",
    apiHandler: {
      fetch(mcpRequest: Request, _env: OAuthEdgeEnv, mcpCtx: ExecutionContext) {
        const { userId } = decodeOAuthProps(mcpCtx.props);

        return handleMcpRequest(mcpRequest, userId, infraLayer);
      },
    },
    defaultHandler: {
      fetch(appRequest: Request, env: OAuthEdgeEnv) {
        const oauthLayer = env.OAUTH_PROVIDER
          ? OAuthProviderService.layerFromHelpers(env.OAUTH_PROVIDER)
          : OAuthProviderService.unavailableLayer;

        return handleWebRequest(appRequest, infraLayer, oauthLayer);
      },
    },
    authorizeEndpoint: "/oauth/authorize",
    tokenEndpoint: "/token",
    clientRegistrationEndpoint: "/register",
    scopesSupported: ["read"],
    requiredScopes: ["read"],
    clientIdMetadataDocumentEnabled: true,
    resourceMetadata: { resource: new URL("/mcp", request.url).href },
  });

  return provider.fetch(request, { OAUTH_KV: oauthKv }, ctx);
}
