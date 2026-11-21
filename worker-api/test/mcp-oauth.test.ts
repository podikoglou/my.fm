import { createExecutionContext, waitOnExecutionContext } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { eq } from "drizzle-orm";
import { expect, test } from "vitest";
import z from "zod";

import { createDatabase } from "../src/db/index.ts";
import { scrobbles, users } from "../src/db/schema.ts";
import { RATE_LIMITS } from "../src/rate-limits.ts";
import worker from "../src/worker.ts";
import { signIn } from "./session.ts";

test("Spotify sign-in round-trips the onboarding destination and OAuth query", async () => {
  const consent = "/oauth/authorize?client_id=example&state=a%2Bb%26c&code_challenge=challenge";
  const callbackURL = "http://app.test/onboard?" + new URLSearchParams({ returnTo: consent });

  await signIn({ id: "oauth-return", email: "return@example.com", callbackURL });
});

const origin = "https://app.test";
const redirectUri = "https://client.example/callback";
const verifier = "a".repeat(64);

const toolResponse = z.object({
  result: z.object({
    isError: z.boolean().optional(),
    content: z.array(z.object({ type: z.literal("text"), text: z.string() })),
  }),
});

async function request(path: string, init?: RequestInit) {
  const ctx = createExecutionContext();
  const response = await worker.fetch(new Request(origin + path, init), env, ctx);
  await waitOnExecutionContext(ctx);

  return response;
}

async function register() {
  const response = await request("/register", {
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
  });

  expect(response.status).toBe(201);

  return z.object({ client_id: z.string() }).parse(await response.json()).client_id;
}

async function authorizationQuery(clientId: string) {
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
    resource: origin + "/mcp",
  }).toString();
}

async function decide(cookie: string, query: string, decision: "allow" | "deny") {
  return request("/api/oauth/authorize", {
    method: "POST",
    headers: { cookie, "content-type": "application/json" },
    body: JSON.stringify({ query, decision }),
  });
}

async function authorize(cookie: string) {
  const clientId = await register();
  const query = await authorizationQuery(clientId);
  const info = await request("/api/oauth/authorize?" + query, { headers: { cookie } });
  expect(info.status).toBe(200);
  expect(await info.json()).toEqual({
    client: { clientId, clientName: "Test MCP client", clientUri: "https://client.example" },
    scope: ["read"],
  });

  const allowed = await decide(cookie, query, "allow");
  expect(allowed.status).toBe(200);
  const { redirectTo } = z.object({ redirectTo: z.string() }).parse(await allowed.json());
  const redirect = new URL(redirectTo);
  expect(redirect.origin + redirect.pathname).toBe(redirectUri);
  expect(redirect.searchParams.get("state")).toBe("original-state");

  return { clientId, code: z.string().parse(redirect.searchParams.get("code")) };
}

async function exchange(clientId: string, code: string, codeVerifier = verifier) {
  return request("/token", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      code,
      code_verifier: codeVerifier,
      redirect_uri: redirectUri,
      resource: origin + "/mcp",
    }),
  });
}

async function token(cookie: string) {
  const { clientId, code } = await authorize(cookie);
  const response = await exchange(clientId, code);
  expect(response.status).toBe(200);

  return z.object({ access_token: z.string() }).parse(await response.json()).access_token;
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

  return toolResponse.parse(await response.json()).result;
}

function text(result: z.infer<typeof toolResponse>["result"]) {
  return z.string().parse(result.content[0]?.text);
}

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

test("denies consent safely, rejects invalid requests and enforces PKCE", async () => {
  const owner = await signIn({ id: "oauth-owner", email: "owner@example.com" });
  const clientId = await register();
  const query = await authorizationQuery(clientId);
  const response = await decide(owner.cookie, query, "deny");
  expect(response.status).toBe(200);
  const { redirectTo } = z.object({ redirectTo: z.string() }).parse(await response.json());
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
  const db = createDatabase(env.DB);
  await db
    .update(users)
    .set({ username: "owner", onboarded: true, isPrivate: true })
    .where(eq(users.id, owner.userId));
  const publicId = "V1StGXR8_Z5jdHi6B-myT";
  const privateId = "V1StGXR8_Z5jdHi6B-myU";
  await db.insert(users).values([
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
  await db.insert(scrobbles).values(
    Array.from({ length: 9 }, (_, index) => ({
      id: index.toString(16).padStart(32, "0"),
      userId: owner.userId,
      trackName: "Private song",
      scrobbleDate: new Date("2026-11-01T00:30:00Z"),
    })),
  );
  await db.insert(scrobbles).values({
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
  } = z
    .object({
      result: z.object({
        tools: z.array(
          z.object({
            name: z.string(),
            annotations: z.object({
              readOnlyHint: z.boolean(),
              destructiveHint: z.boolean(),
              idempotentHint: z.boolean(),
            }),
          }),
        ),
      }),
    })
    .parse(await listed.json());

  expect(tools.map(({ name }) => name).sort()).toEqual([
    "get_me",
    "get_public_feed",
    "get_recent_scrobbles",
    "get_scrobble_months",
    "get_user",
  ]);

  for (const tool of tools) {
    expect(tool.annotations).toEqual({
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    });
  }

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
    offset: 0,
  });

  expect(
    z.array(z.object({ track: z.object({ name: z.string() }) })).parse(JSON.parse(text(recent))),
  ).toHaveLength(8);

  const empty = await callTool(accessToken, "get_recent_scrobbles", {
    username: "owner",
    offset: 0,
    before: 0,
  });

  expect(JSON.parse(text(empty))).toEqual([]);

  const capped = await callTool(accessToken, "get_recent_scrobbles", {
    username: "owner",
    offset: 0,
    limit: 9,
  });

  expect(capped.isError).toBe(true);

  const months = await callTool(accessToken, "get_scrobble_months", {
    username: "owner",
    timeZone: "America/Los_Angeles",
  });

  expect(JSON.parse(text(months))).toEqual([{ month: "2026-10", count: 9 }]);
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
    ["get_recent_scrobbles", { username: "private", offset: 0 }],
    ["get_scrobble_months", { username: "private" }],
  ] as const) {
    const result = await callTool(accessToken, name, args);
    expect(result.isError).toBe(true);
    expect(text(result)).toBe("Profile is private");
  }

  const missing = await callTool(accessToken, "get_user", { username: "missing" });
  expect(missing.isError).toBe(true);
  expect(text(missing)).toBe("User not found");
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
