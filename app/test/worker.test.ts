import { expect, test } from "bun:test";

import worker from "../worker.ts";

type WebsiteEnv = Parameters<typeof worker.fetch>[1];

function createEnv() {
  const apiPaths: string[] = [];
  const assetPaths: string[] = [];

  const env = {
    API: {
      fetch: async (request: Request) => {
        apiPaths.push(new URL(request.url).pathname);
        return new Response("api");
      },
    },
    ASSETS: {
      fetch: async (request: Request) => {
        assetPaths.push(new URL(request.url).pathname);
        return new Response("asset");
      },
    },
  } as unknown as WebsiteEnv;

  return { env, apiPaths, assetPaths };
}

test("forwards API paths over the service binding", async () => {
  const { env, apiPaths, assetPaths } = createEnv();

  for (const path of ["/api/auth/get-session", "/user/me", "/scrobble/getRecent", "/health"]) {
    const response = await worker.fetch(new Request(`https://app.test${path}`), env);

    expect(await response.text()).toBe("api");
  }

  expect(apiPaths).toEqual(["/api/auth/get-session", "/user/me", "/scrobble/getRecent", "/health"]);
  expect(assetPaths).toEqual([]);
});

test("serves every other path from the assets", async () => {
  const { env, apiPaths, assetPaths } = createEnv();

  for (const path of ["/", "/app", "/app/user/alex", "/apiary", "/api"]) {
    const response = await worker.fetch(new Request(`https://app.test${path}`), env);

    expect(await response.text()).toBe("asset");
  }

  expect(apiPaths).toEqual([]);
  expect(assetPaths).toEqual(["/", "/app", "/app/user/alex", "/apiary", "/api"]);
});

test("returns the API response and request unchanged", async () => {
  const redirect = new Response(null, {
    status: 302,
    headers: {
      location: "https://accounts.spotify.com/authorize",
      "set-cookie": "better-auth.state=abc; Path=/; HttpOnly",
    },
  });
  const received: Request[] = [];

  const env = {
    API: {
      fetch: async (request: Request) => {
        received.push(request);
        return redirect;
      },
    },
    ASSETS: { fetch: async () => new Response("asset") },
  } as unknown as WebsiteEnv;

  const request = new Request("https://app.test/api/auth/callback/spotify?code=1", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      cookie: "better-auth.state=abc",
      origin: "https://app.test",
    },
    body: '{"code":"1"}',
  });

  const response = await worker.fetch(request, env);

  expect(response).toBe(redirect);
  expect(received[0]).toBe(request);
  expect(response.status).toBe(302);
  expect(response.headers.get("location")).toBe("https://accounts.spotify.com/authorize");
  expect(response.headers.get("set-cookie")).toBe("better-auth.state=abc; Path=/; HttpOnly");
  expect(received[0]!.method).toBe("POST");
  expect(received[0]!.headers.get("cookie")).toBe("better-auth.state=abc");
  expect(received[0]!.headers.get("origin")).toBe("https://app.test");
});
