import { expect, test as base, type Route } from "@playwright/test";

import {
  account,
  app,
  consent,
  cover,
  feedItem,
  listener,
  notification,
  now,
  play,
  spotifyLogin,
} from "./data";

type Scenario = {
  session?: "out" | "in" | "onboarding";
  feed?: "empty" | "error" | "paged";
  history?: "empty" | "error" | "paged";
  consent?: "invalid";
  notification?: boolean;
};

type Json =
  | boolean
  | number
  | string
  | null
  | readonly Json[]
  | { readonly [key: string]: Json | undefined };

function json(route: Route, value: Json, status = 200) {
  return route.fulfill({ json: value, status });
}

function api(scenario: Scenario, unexpected: string[]) {
  let signedIn = !!scenario.session && scenario.session !== "out";
  let onboarded = scenario.session === "in";
  let isPrivate: boolean = account.isPrivate;
  let hasNotification = scenario.notification ?? false;
  let connected = true;
  let uploaded = false;

  return async (route: Route) => {
    const request = route.request();
    const { pathname, searchParams } = new URL(request.url());
    const endpoint = `${request.method()} ${pathname}`;

    switch (endpoint) {
      case "GET /api/auth/get-session":
        return json(
          route,
          signedIn
            ? {
                user: { ...account, emailVerified: true, createdAt: now, updatedAt: now },
                session: {
                  id: "fixture-session",
                  userId: account.id,
                  expiresAt: "2030-04-16T12:00:00.000Z",
                },
              }
            : null,
        );
      case "POST /api/auth/sign-in/social":
        return json(route, { redirect: true, url: spotifyLogin });
      case "POST /api/auth/sign-out":
        signedIn = false;

        return json(route, { success: true });
      case "GET /api/user/me":
        return signedIn
          ? json(route, { ...account, onboarded, isPrivate })
          : json(route, { error: "" }, 401);
      case "GET /api/user/byUsername": {
        const username = searchParams.get("username");

        if (username === "private" || (username === listener.username && isPrivate && !signedIn)) {
          return json(route, { error: "Profile is private" }, 403);
        }

        return username === listener.username
          ? json(route, listener)
          : json(route, { error: "User not found" }, 404);
      }

      case "PATCH /api/user/settings":
        isPrivate = !isPrivate;

        return json(route, { isPrivate });
      case "PUT /api/user/onboard":
        onboarded = true;

        return json(route, { ok: true });
      case "GET /api/feed":
        if (scenario.feed === "error") return json(route, { error: "Feed unavailable" }, 503);

        if (scenario.feed === "empty") return json(route, { items: [], nextCursor: null });

        if (scenario.feed === "paged" && searchParams.get("cursor") === "next-feed") {
          return json(route, { items: [feedItem(30, "After the Break")], nextCursor: null });
        }

        return json(
          route,
          scenario.feed === "paged"
            ? {
                items: Array.from({ length: 30 }, (_, index) =>
                  feedItem(index, index === 0 ? "Morning Tide" : `Coastline ${index}`),
                ),
                nextCursor: "next-feed",
              }
            : {
                items: [
                  feedItem(0, "Morning Tide"),
                  feedItem(1, "Low Water"),
                  feedItem(2, "Harbor Light"),
                ],
                nextCursor: null,
              },
        );
      case "GET /api/scrobble/getMonths":
        if (scenario.history === "error") return json(route, { error: "History unavailable" }, 503);

        return json(
          route,
          scenario.history === "empty"
            ? []
            : [{ month: "2026-04", count: scenario.history === "paged" ? 32 : 3 }],
        );
      case "GET /api/scrobble/getRecent": {
        const offset = Number(searchParams.get("offset") ?? "0");
        const limit = Number(searchParams.get("limit") ?? "8");
        const count = scenario.history === "paged" ? 32 : 3;

        return json(
          route,
          Array.from({ length: Math.max(0, Math.min(limit, count - offset)) }, (_, index) => {
            const position = index + offset;

            return play(position, position === 0 ? "Morning Tide" : `History track ${position}`);
          }),
        );
      }

      case "GET /api/notifications":
        return json(route, { notifications: hasNotification ? [notification] : [] });
      case "POST /api/notifications/notice-1/acknowledge":
        hasNotification = false;

        return json(route, { ok: true });
      case "GET /api/import/latest":
        return json(route, {
          import: uploaded
            ? {
                id: "import-1",
                userId: account.id,
                filename: "history.csv",
                status: "pending",
                cursor: 0,
                totalLines: 1,
                processedRows: 0,
                skippedRows: 0,
                attemptCount: 0,
                error: null,
                createdAt: now,
                updatedAt: now,
              }
            : null,
        });
      case "POST /api/import":
        uploaded = true;

        return json(
          route,
          { id: "import-1", filename: "history.csv", status: "pending", totalLines: 1 },
          202,
        );
      case "GET /api/oauth/apps":
        return json(route, { apps: connected ? [app] : [] });
      case "DELETE /api/oauth/apps/app-1":
        connected = false;

        return json(route, { success: true });
      case "GET /api/oauth/authorize":
        return scenario.consent === "invalid"
          ? json(route, { error: "Invalid OAuth request" }, 400)
          : json(route, consent);
      case "POST /api/oauth/authorize":
        return json(route, { redirectTo: consent.redirectUri });
      default:
        unexpected.push(endpoint);

        return json(route, { error: `No parity fixture for ${endpoint}` }, 501);
    }
  };
}

export const test = base.extend<{ scenario: Scenario; network: void }>({
  scenario: [{}, { option: true }],
  network: [
    async ({ baseURL, context, page, scenario }, use) => {
      if (!baseURL) throw new Error("The parity fixture needs a base URL");

      const unexpected: string[] = [];
      const serveApi = api(scenario, unexpected);
      const appOrigin = new URL(baseURL).origin;

      await page.clock.setFixedTime(new Date(now));
      await context.route("**/*", async (route) => {
        const url = new URL(route.request().url());

        if (url.origin === appOrigin) {
          return url.pathname.startsWith("/api/") ? serveApi(route) : route.continue();
        }

        if (url.href === "https://fixtures.example.test/cover.svg") {
          return route.fulfill({ contentType: "image/svg+xml", body: cover });
        }

        if (url.href === spotifyLogin || url.href === consent.redirectUri) {
          return route.fulfill({ contentType: "text/plain", body: "Fixture redirect destination" });
        }

        return route.abort();
      });

      await use();
      expect(unexpected, "Unexpected API requests").toEqual([]);
    },
    { auto: true },
  ],
});

export { expect };
