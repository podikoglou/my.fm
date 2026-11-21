import { authorizationErrorRedirect } from "@cloudflare/workers-oauth-provider";
import { zValidator } from "@hono/zod-validator";
import { Hono } from "hono";
import z from "zod";

import type { AppEnv } from "../types.ts";

import { requireSession, sessionMiddleware } from "../auth-middleware.ts";
import { rateLimit } from "../rate-limit-middleware.ts";

const grantMetadataSchema = z.object({ label: z.string().optional() });

export default new Hono<AppEnv>()
  .use("*", rateLimit("AUTH_RATE_LIMIT"), sessionMiddleware, requireSession)
  .get("/authorize", async (c) => {
    const url = new URL("/oauth/authorize", c.req.url);
    url.search = new URL(c.req.url).search;

    try {
      const request = await c.env.OAUTH_PROVIDER.parseAuthRequest(new Request(url.href));
      const client = await c.env.OAUTH_PROVIDER.lookupClient(request.clientId);

      if (!client) return c.json({ error: "Invalid OAuth request" }, 400);

      return c.json({
        client: {
          clientId: client.clientId,
          clientName: client.clientName,
          clientUri: client.clientUri,
        },
        scope: request.scope,
        redirectUri: request.redirectUri,
      });
    } catch {
      return c.json({ error: "Invalid OAuth request" }, 400);
    }
  })
  .post(
    "/authorize",
    zValidator("json", z.object({ decision: z.enum(["allow", "deny"]), query: z.string() })),
    async (c) => {
      const { decision, query } = c.req.valid("json");
      const { id: userId } = await c.get("getUserData")();
      const url = new URL("/oauth/authorize", c.req.url);
      url.search = query;

      try {
        const request = await c.env.OAUTH_PROVIDER.parseAuthRequest(new Request(url.href));
        const client = await c.env.OAUTH_PROVIDER.lookupClient(request.clientId);

        if (!client) return c.json({ error: "Invalid OAuth request" }, 400);

        if (decision === "deny") {
          return c.json({ redirectTo: authorizationErrorRedirect(request, "access_denied") });
        }

        const result = await c.env.OAUTH_PROVIDER.completeAuthorization({
          request,
          userId,
          metadata: { label: client.clientName },
          scope: ["read"],
          props: { userId },
        });

        return c.json({ redirectTo: result.redirectTo });
      } catch {
        return c.json({ error: "Invalid OAuth request" }, 400);
      }
    },
  )
  .get("/apps", async (c) => {
    const { id: userId } = await c.get("getUserData")();
    const { items } = await c.env.OAUTH_PROVIDER.listUserGrants(userId);

    const apps = await Promise.all(
      items.map(async (item) => {
        let clientName: string | undefined;
        let clientUri: string | undefined;

        try {
          const client = await c.env.OAUTH_PROVIDER.lookupClient(item.clientId);

          if (client) {
            clientName = client.clientName;
            clientUri = client.clientUri;
          }
        } catch {
          // Fall back to stored metadata if client lookup fails.
        }

        const metadata = grantMetadataSchema.safeParse(item.metadata);
        const label = metadata.success ? metadata.data.label : undefined;

        return {
          id: item.id,
          clientId: item.clientId,
          name: clientName ?? label ?? item.clientId,
          clientUri,
          scope: item.scope,
          createdAt: item.createdAt,
        };
      }),
    );

    apps.sort((a, b) => b.createdAt - a.createdAt);

    return c.json({ apps });
  })
  .delete("/apps/:id", zValidator("param", z.object({ id: z.string().min(1) })), async (c) => {
    const { id } = c.req.valid("param");
    const { id: userId } = await c.get("getUserData")();

    await c.env.OAUTH_PROVIDER.revokeGrant(id, userId);

    return c.json({ success: true });
  });
