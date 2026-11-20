import { expect, test } from "vitest";

import worker from "../worker.ts";

type WebsiteEnv = Parameters<typeof worker.fetch>[1];

function createService(handleRequest: (request: Request) => Promise<Response>): Fetcher {
  return {
    fetch(input) {
      return handleRequest(input instanceof Request ? input : new Request(input));
    },
    connect() {
      throw new Error("Test service bindings do not open socket connections.");
    },
  };
}

function requestPath(request: Request) {
  return new URL(request.url).pathname;
}

function createEnv() {
  const apiPaths: string[] = [];
  const assetPaths: string[] = [];

  const env: WebsiteEnv = {
    API: createService(async (request) => {
      apiPaths.push(requestPath(request));

      return new Response("api");
    }),
    ASSETS: createService(async (request) => {
      assetPaths.push(requestPath(request));

      return new Response("asset");
    }),
  };

  return { env, apiPaths, assetPaths };
}

test("forwards API paths over the service binding", async () => {
  const { env, apiPaths, assetPaths } = createEnv();

  for (const path of [
    "/api/auth/get-session",
    "/api/user/me",
    "/api/scrobble/getRecent",
    "/health",
  ]) {
    const response = await worker.fetch(new Request(`https://app.test${path}`), env);

    expect(await response.text()).toBe("api");
  }

  expect(apiPaths).toEqual([
    "/api/auth/get-session",
    "/api/user/me",
    "/api/scrobble/getRecent",
    "/health",
  ]);
  expect(assetPaths).toEqual([]);
});

test("serves every other path from the assets", async () => {
  const { env, apiPaths, assetPaths } = createEnv();

  const paths = ["/", "/user/alex", "/settings", "/apiary", "/api"];

  for (const path of paths) {
    const response = await worker.fetch(new Request(`https://app.test${path}`), env);

    expect(await response.text()).toBe("asset");
  }

  expect(apiPaths).toEqual([]);
  expect(assetPaths).toEqual(paths);
});
