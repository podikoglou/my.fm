import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

import { AUTH_ERROR_ROUTE } from "./lib/auth-paths";

export default [
  layout("routes/layout.tsx", [
    // The guarded layout has no path, so `/` and `/settings` keep their URLs.
    layout("routes/app/layout.tsx", [
      index("routes/app/index.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),

    route("user/:username", "routes/app/user.tsx"),

    route("onboard", "routes/onboard.tsx"),

    route(AUTH_ERROR_ROUTE, "routes/auth-error.tsx"),
  ]),
] satisfies RouteConfig;
