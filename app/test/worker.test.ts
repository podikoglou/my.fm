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
