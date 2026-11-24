import { HttpApi, OpenApi } from "effect/http-api";

import { HealthGroup } from "./health.ts";

export * from "./health.ts";

/**
 * Shared HTTP API contract for my.fm.
 *
 * Kept separate from server handlers and Cloudflare bindings so the frontend
 * can import `MyFmApi` directly for `HttpApiClient.make(MyFmApi)`.
 */
export class MyFmApi extends HttpApi.make("my-fm-api")
  .add(HealthGroup)
  .annotateMerge(
    OpenApi.annotations({
      title: "my.fm API",
    }),
  ) {}
