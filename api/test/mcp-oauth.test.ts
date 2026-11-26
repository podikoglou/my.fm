import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { Schema } from "effect";
import { expect, test } from "vitest";

import { RATE_LIMITS } from "../src/rate-limits.ts";
import worker from "../src/worker.ts";
import { insertRows, updateRows } from "./d1.ts";
import { signIn } from "./session.ts";

test("Spotify sign-in round-trips the onboarding destination and OAuth query", async () => {
  const consent = "/oauth/authorize?client_id=example&state=a%2Bb%26c&code_challenge=challenge";
  const callbackURL = "https://app.test/onboard?" + new URLSearchParams({ returnTo: consent });

  await signIn({ id: "oauth-return", email: "return@example.com", callbackURL });
});

const origin = "https://app.test";
const redirectUri = "https://client.example/callback";
const verifier = "a".repeat(64);

const ToolResponseSchema = Schema.Struct({
  result: Schema.Struct({
    isError: Schema.optional(Schema.Boolean),
    content: Schema.Array(Schema.Struct({ type: Schema.Literal("text"), text: Schema.String })),
  }),
});

const ClientIdResponseSchema = Schema.Struct({ client_id: Schema.String });
const RedirectToResponseSchema = Schema.Struct({ redirectTo: Schema.String });
const AccessTokenResponseSchema = Schema.Struct({ access_token: Schema.String });

const ToolsListResponseSchema = Schema.Struct({
  result: Schema.Struct({
    tools: Schema.Array(
      Schema.Struct({
        name: Schema.String,
        annotations: Schema.Struct({
          readOnlyHint: Schema.Boolean,
          destructiveHint: Schema.Boolean,
          idempotentHint: Schema.Boolean,
        }),
      }),
    ),
  }),
});

const RecentScrobblesSchema = Schema.Array(
  Schema.Struct({ track: Schema.Struct({ name: Schema.String }) }),
);

const OAuthAppsResponseSchema = Schema.Struct({
  apps: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      clientId: Schema.String,
      name: Schema.String,
      clientUri: Schema.optional(Schema.String),
      scope: Schema.Array(Schema.String),
      createdAt: Schema.Number,
    }),
  ),
});

async function request(path: string, init?: RequestInit, requestOrigin = origin) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(requestOrigin + path, init), env, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

async function register(requestOrigin = origin) {
  const response = await request(
    "/register",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        client_name: "Test MCP client",
        client_uri: "https://client.example",
        redirect_uris: [redirectUri],
        grant_types: ["authorization_code", "refresh_token"],
        response_types: ["code"],
        token_endpoint_auth_method: "none",
      }),
    },
    requestOrigin,
  );

  expect(response.status).toBe(201);

  return Schema.decodeUnknownSync(ClientIdResponseSchema)(await response.json()).client_id;
}

async function authorizationQuery(clientId: string, requestOrigin = origin) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));

  const challenge = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replace(/=+$/, "");

  return new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read",
    state: "original-state",
    code_challenge: challenge,
    code_challenge_method: "S256",
    resource: requestOrigin + "/mcp",
  }).toString();
}

async function decide(
  cookie: string,
  query: string,
  decision: "allow" | "deny",
  requestOrigin = origin,
) {
  return request(
    "/api/oauth/authorize",
    {
      method: "POST",
      headers: { cookie, "content-type": "application/json" },
      body: JSON.stringify({ query, decision }),
    },
    requestOrigin,
  );
}

async function authorize(cookie: string, requestOrigin = origin) {
  const clientId = await register(requestOrigin);
  const query = await authorizationQuery(clientId, requestOrigin);

  const info = await request(
    "/api/oauth/authorize?" + query,
    { headers: { cookie } },
    requestOrigin,
  );

  expect(info.status).toBe(200);
  expect(await info.json()).toEqual({
    client: { clientId, clientName: "Test MCP client", clientUri: "https://client.example" },
    scope: ["read"],
    redirectUri,
  });

  const allowed = await decide(cookie, query, "allow", requestOrigin);
  expect(allowed.status).toBe(200);
  const { redirectTo } = Schema.decodeUnknownSync(RedirectToResponseSchema)(await allowed.json());
  const redirect = new URL(redirectTo);
  expect(redirect.origin + redirect.pathname).toBe(redirectUri);
  expect(redirect.searchParams.get("state")).toBe("original-state");

  return {
    clientId,
    code: Schema.decodeUnknownSync(Schema.String)(redirect.searchParams.get("code")),
  };
}

async function exchange(
  clientId: string,
  code: string,
  codeVerifier = verifier,
  requestOrigin = origin,
) {
  return request(
    "/token",
    {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: clientId,
        code,
        code_verifier: codeVerifier,
        redirect_uri: redirectUri,
        resource: requestOrigin + "/mcp",
      }),
    },
    requestOrigin,
  );
}

async function token(cookie: string, requestOrigin = origin) {
  const { clientId, code } = await authorize(cookie, requestOrigin);
  const response = await exchange(clientId, code, verifier, requestOrigin);
  expect(response.status).toBe(200);

  return Schema.decodeUnknownSync(AccessTokenResponseSchema)(await response.json()).access_token;
}

async function callTool(
  accessToken: string,
  name: string,
  args: Record<string, string | number | undefined> = {},
) {
  const response = await request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name, arguments: args },
    }),
  });

  expect(response.status).toBe(200);
  expect(response.headers.has("mcp-session-id")).toBe(false);

  return Schema.decodeUnknownSync(ToolResponseSchema)(await response.json()).result;
}

function text(result: Schema.Schema.Type<typeof ToolResponseSchema>["result"]) {
  return Schema.decodeUnknownSync(Schema.String)(result.content[0]?.text);
}

test("keeps authorization helpers and token audiences local to each request origin", async () => {
  const owner = await signIn({ id: "oauth-origins", email: "origins@example.com" });

  for (const requestOrigin of [origin, "https://second.test"]) {
    const accessToken = await token(owner.cookie, requestOrigin);

    const response = await request(
      "/mcp",
      {
        method: "POST",
        headers: {
          authorization: "Bearer " + accessToken,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: 1,
          method: "tools/call",
          params: { name: "get_me" },
        }),
      },
      requestOrigin,
    );

    expect(response.status).toBe(200);
    expect(
      Schema.decodeUnknownSync(ToolResponseSchema)(await response.json()).result.isError,
    ).not.toBe(true);
  }
});

test("discovers the public origin and challenges unauthenticated MCP requests", async () => {
  const metadata = await request("/.well-known/oauth-authorization-server");
  expect(metadata.status).toBe(200);
  expect(await metadata.json()).toMatchObject({
    issuer: origin,
    authorization_endpoint: origin + "/oauth/authorize",
    token_endpoint: origin + "/token",
    registration_endpoint: origin + "/register",
    scopes_supported: ["read"],
    code_challenge_methods_supported: ["S256"],
    client_id_metadata_document_supported: true,
  });
  const protectedMetadata = await request("/.well-known/oauth-protected-resource/mcp");
  expect(protectedMetadata.status).toBe(200);
  expect(await protectedMetadata.json()).toMatchObject({
    resource: origin + "/mcp",
    authorization_servers: [origin],
    scopes_supported: ["read"],
  });

  const response = await request("/mcp");
  expect(response.status).toBe(401);
  expect(response.headers.get("WWW-Authenticate")).toContain(
    origin + "/.well-known/oauth-protected-resource/mcp",
  );
  expect((await request("/api/oauth/authorize")).status).toBe(401);
});

test("stateless MCP does not offer a standalone SSE stream or session deletion", async () => {
  const owner = await signIn({ id: "oauth-methods", email: "methods@example.com" });
  const accessToken = await token(owner.cookie);

  for (const method of ["GET", "DELETE"]) {
    const response = await request("/mcp", {
      method,
      headers: { authorization: "Bearer " + accessToken, accept: "text/event-stream" },
    });

    expect(response.status).toBe(405);
    expect(response.headers.get("Allow")).toBe("POST");
    expect(await response.text()).toBe("");
    expect(response.headers.has("mcp-session-id")).toBe(false);
  }
});

test("denies consent safely, rejects invalid requests and enforces PKCE", async () => {
  const owner = await signIn({ id: "oauth-owner", email: "owner@example.com" });
  const clientId = await register();
  const query = await authorizationQuery(clientId);
  const response = await decide(owner.cookie, query, "deny");
  expect(response.status).toBe(200);
  const { redirectTo } = Schema.decodeUnknownSync(RedirectToResponseSchema)(await response.json());
  const redirect = new URL(redirectTo);
  expect(redirect.origin + redirect.pathname).toBe(redirectUri);
  expect(redirect.searchParams.get("error")).toBe("access_denied");
  expect(redirect.searchParams.get("state")).toBe("original-state");
  expect(redirect.searchParams.has("code")).toBe(false);

  for (const invalidQuery of [
    "",
    query.replace(encodeURIComponent(redirectUri), encodeURIComponent("https://evil.example")),
  ]) {
    const invalid = await request("/api/oauth/authorize?" + invalidQuery, {
      headers: { cookie: owner.cookie },
    });

    expect(invalid.status).toBe(400);
    expect(await invalid.json()).toEqual({ error: "Invalid OAuth request" });
    expect((await decide(owner.cookie, invalidQuery, "allow")).status).toBe(400);
    expect((await decide(owner.cookie, invalidQuery, "deny")).status).toBe(400);
  }

  const grant = await authorize(owner.cookie);
  expect((await exchange(grant.clientId, grant.code, "b".repeat(64))).status).toBe(400);
});

test("reads through all MCP tools with REST bounds and owner-only private access", async () => {
  const owner = await signIn({ id: "oauth-owner", email: "owner@example.com" });
  await updateRows(
    env.DB,
    "users",
    { username: "owner", onboarded: true, isPrivate: true },
    { id: owner.userId },
  );
  const publicId = "V1StGXR8_Z5jdHi6B-myT";
  const privateId = "V1StGXR8_Z5jdHi6B-myU";
  await insertRows(env.DB, "users", [
    {
      id: publicId,
      username: "public",
      name: "Public",
      email: "public@example.com",
      avatarUrl: "https://example.com/avatar",
      onboarded: true,
      updatedAt: new Date(),
    },
    {
      id: privateId,
      username: "private",
      name: "Private",
      email: "private@example.com",
      onboarded: true,
      isPrivate: true,
      updatedAt: new Date(),
    },
  ]);
  await insertRows(
    env.DB,
    "scrobbles",
    Array.from({ length: 9 }, (_, index) => ({
      id: index.toString(16).padStart(32, "0"),
      userId: owner.userId,
      trackName: "Private song",
      scrobbleDate: new Date("2026-11-01T00:30:00Z"),
    })),
  );
  await insertRows(env.DB, "scrobbles", {
    id: "a".repeat(32),
    userId: publicId,
    trackName: "Public song",
    scrobbleDate: new Date("2026-11-02T00:00:00Z"),
  });
  const accessToken = await token(owner.cookie);

  const initialized = await request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "initialize",
      params: {
        protocolVersion: "2025-03-26",
        capabilities: {},
        clientInfo: { name: "test", version: "1" },
      },
    }),
  });

  expect(initialized.status).toBe(200);
  expect(initialized.headers.has("mcp-session-id")).toBe(false);
  expect(await initialized.json()).toMatchObject({ result: { serverInfo: { name: "my.fm" } } });

  const listed = await request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list" }),
  });

  const {
    result: { tools },
  } = Schema.decodeUnknownSync(ToolsListResponseSchema)(await listed.json());

  expect(tools.map(({ name }) => name).sort()).toEqual([
    "get_me",
    "get_public_feed",
    "get_recent_scrobbles",
    "get_sample",
    "get_scrobble_months",
    "get_summary",
    "get_timeline",
    "get_top",
    "get_user",
  ]);

  for (const tool of tools) {
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  }

  const page = async (cursor?: string) => {
    const result = await callTool(accessToken, "get_recent_scrobbles", {
      username: "owner",
      limit: 5,
      before: Date.parse("2026-11-02T00:00:00Z") / 1000,
      cursor,
    });

    return Schema.decodeUnknownSync(
      Schema.Struct({
        items: Schema.Array(Schema.Struct({ id: Schema.String })),
        nextCursor: Schema.NullOr(Schema.String),
      }),
    )(JSON.parse(text(result)));
  };

  const first = await page();
  expect(first.items).toHaveLength(5);
  expect(first.nextCursor).toEqual(expect.any(String));
  const second = await page(first.nextCursor ?? undefined);
  expect(second.nextCursor).toBeNull();
  expect([...first.items, ...second.items].map(({ id }) => id)).toEqual(
    Array.from({ length: 9 }, (_, index) => (8 - index).toString(16).padStart(32, "0")),
  );

  const me = await callTool(accessToken, "get_me");
  expect(me.isError).not.toBe(true);
  expect(JSON.parse(text(me))).toEqual({
    id: owner.userId,
    username: "owner",
    name: "Test User",
    onboarded: true,
    isPrivate: true,
  });

  for (const args of [{ username: "owner" }, { id: owner.userId }, { username: "public" }]) {
    const result = await callTool(accessToken, "get_user", args);
    expect(result.isError).not.toBe(true);
    expect(text(result)).not.toContain("email");
    expect(text(result)).not.toContain("avatarUrl");
  }

  const recent = await callTool(accessToken, "get_recent_scrobbles", {
    username: "owner",
  });

  expect(
    Schema.decodeUnknownSync(RecentScrobblesSchema)(JSON.parse(text(recent)).items),
  ).toHaveLength(9);

  const empty = await callTool(accessToken, "get_recent_scrobbles", {
    username: "owner",
    before: 0,
  });

  expect(JSON.parse(text(empty))).toEqual({ items: [], nextCursor: null });

  const capped = await callTool(accessToken, "get_recent_scrobbles", {
    username: "owner",
    limit: 201,
  });

  expect(capped.isError).toBe(true);

  const months = await callTool(accessToken, "get_scrobble_months", {
    username: "owner",
    timeZone: "America/Los_Angeles",
  });

  expect(JSON.parse(text(months))).toEqual([{ month: "2026-10", count: 9 }]);
  const summary = await callTool(accessToken, "get_summary", { username: "owner" });
  expect(JSON.parse(text(summary))).toMatchObject({
    totalScrobbles: 9,
    topTracks: [{ name: "Private song", plays: 9, share: 1 }],
  });
  expect(
    (await callTool(accessToken, "get_top", { username: "owner", kind: "tracks", limit: 51 }))
      .isError,
  ).toBe(true);
  expect(
    (await callTool(accessToken, "get_timeline", { username: "owner", bucket: "hour" })).isError,
  ).toBe(true);
  const feed = await callTool(accessToken, "get_public_feed", { limit: 1 });
  expect(JSON.parse(text(feed))).toMatchObject({
    items: [{ id: "a".repeat(32), user: { username: "public", name: "Public" } }],
    nextCursor: null,
  });
  expect(text(feed)).not.toContain("avatarUrl");
  expect(text(feed)).not.toContain("Private song");
  expect((await callTool(accessToken, "get_public_feed", { limit: 51 })).isError).toBe(true);
  expect((await callTool(accessToken, "get_public_feed", { cursor: "bad" })).isError).toBe(true);

  for (const [name, args] of [
    ["get_user", { username: "private" }],
    ["get_user", { id: privateId }],
    ["get_recent_scrobbles", { username: "private" }],
    ["get_scrobble_months", { username: "private" }],
    ["get_sample", { username: "private" }],
  ] as const) {
    const result = await callTool(accessToken, name, args);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Profile is private");
  }

  const missing = await callTool(accessToken, "get_user", { username: "missing" });
  expect(missing.isError).toBe(true);
  expect(text(missing)).toBe("User not found");
});

test("returns 50 recent plays by default and accepts a full 200-play page", async () => {
  const owner = await signIn({ id: "oauth-pages", email: "pages@example.com" });
  await updateRows(env.DB, "users", { username: "pages" }, { id: owner.userId });
  await insertRows(
    env.DB,
    "scrobbles",
    Array.from({ length: 200 }, (_, index) => ({
      id: index.toString(16).padStart(32, "0"),
      userId: owner.userId,
      scrobbleDate: new Date("2026-11-01T00:30:00Z"),
      trackName: "Song",
    })),
  );
  const accessToken = await token(owner.cookie);

  const page = await callTool(accessToken, "get_recent_scrobbles", { username: "pages" });
  expect(JSON.parse(text(page)).items).toHaveLength(50);

  const full = await callTool(accessToken, "get_recent_scrobbles", {
    username: "pages",
    limit: 200,
  });

  expect(JSON.parse(text(full)).items).toHaveLength(200);
  expect(JSON.parse(text(full)).nextCursor).toBeNull();
});

test("enforces the real public-read budget keyed by authenticated user", async () => {
  const owner = await signIn({ id: "oauth-owner", email: "owner@example.com" });
  const accessToken = await token(owner.cookie);
  const periodMs = RATE_LIMITS.PUBLIC_READ_RATE_LIMIT.period * 1000;
  const remainingMs = periodMs - (Date.now() % periodMs);

  if (remainingMs < 5000) {
    await new Promise<void>((resolve) => {
      setTimeout(resolve, remainingMs);
    });
  }

  for (let index = 0; index < RATE_LIMITS.PUBLIC_READ_RATE_LIMIT.limit - 1; index += 1) {
    expect(await env.PUBLIC_READ_RATE_LIMIT.limit({ key: owner.userId })).toEqual({
      success: true,
    });
  }

  expect((await callTool(accessToken, "get_me")).isError).not.toBe(true);
  const rejected = await callTool(accessToken, "get_me");
  expect(rejected.isError).toBe(true);
  expect(text(rejected)).toBe("Too many requests");
});

test("lists connected apps and revokes access", async () => {
  const user = await signIn({ id: "oauth-connected", email: "connected@example.com" });
  const accessToken = await token(user.cookie);

  const listRes = await request("/api/oauth/apps", { headers: { cookie: user.cookie } });

  expect(listRes.status).toBe(200);

  const { apps } = Schema.decodeUnknownSync(OAuthAppsResponseSchema)(await listRes.json());

  expect(apps.length).toBe(1);
  const firstApp = apps[0];
  expect(firstApp).toBeDefined();
  expect(firstApp?.name).toBe("Test MCP client");
  expect(firstApp?.scope).toEqual(["read"]);

  const initialCall = await callTool(accessToken, "get_me");
  expect(initialCall.isError).not.toBe(true);

  const appId = firstApp!.id;

  const deleteRes = await request(`/api/oauth/apps/${appId}`, {
    method: "DELETE",
    headers: { cookie: user.cookie },
  });

  expect(deleteRes.status).toBe(200);
  expect(await deleteRes.json()).toEqual({ success: true });

  const emptyRes = await request("/api/oauth/apps", { headers: { cookie: user.cookie } });
  expect(emptyRes.status).toBe(200);
  expect(await emptyRes.json()).toEqual({ apps: [] });

  const rejectedCall = await request("/mcp", {
    method: "POST",
    headers: {
      authorization: "Bearer " + accessToken,
      "content-type": "application/json",
      accept: "application/json, text/event-stream",
    },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "get_me", arguments: {} },
    }),
  });

  expect(rejectedCall.status).toBe(401);

  expect((await request("/api/oauth/apps")).status).toBe(401);
  expect((await request(`/api/oauth/apps/${appId}`, { method: "DELETE" })).status).toBe(401);
});

test("rejects invalid before and empty username on MCP scrobble tools", async () => {
  const user = await signIn({ id: "oauth-validation", email: "validation@example.com" });
  const accessToken = await token(user.cookie);

  const fractionalBefore = await callTool(accessToken, "get_recent_scrobbles", {
    username: "alex",
    before: 12.5,
  });

  expect(fractionalBefore.isError).toBe(true);

  const negativeBefore = await callTool(accessToken, "get_recent_scrobbles", {
    username: "alex",
    before: -1,
  });

  expect(negativeBefore.isError).toBe(true);

  const emptyUsername = await callTool(accessToken, "get_recent_scrobbles", {
    username: "",
  });

  expect(emptyUsername.isError).toBe(true);
});
