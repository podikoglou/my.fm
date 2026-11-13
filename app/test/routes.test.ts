import { expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { AUTH_ERROR_PATH, AUTH_ERROR_ROUTE } from "../app/lib/auth-paths.ts";
import routes from "../app/routes.ts";

type RouteNode = { file?: string; path?: string; children?: RouteNode[] };

/** Flatten the route table, because child routes live inside layouts. */
function flatten(nodes: readonly RouteNode[]): RouteNode[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children ?? [])]);
}

test("the OAuth error page is registered where Better Auth redirects", () => {
  const node = flatten(routes).find(({ path }) => path === AUTH_ERROR_ROUTE);

  expect(node).toBeDefined();
  expect(`/${node!.path}`).toBe(AUTH_ERROR_PATH);
  expect(existsSync(join(import.meta.dir, "../app", node!.file!))).toBe(true);
});

test("the profile is a page at /user/:username and not below /app", () => {
  const paths = flatten(routes).flatMap(({ path }) => (path === undefined ? [] : [path]));

  expect(paths).toContain("user/:username");
  expect(paths.filter((path) => path === "app" || path.startsWith("app/"))).toEqual([]);
});
