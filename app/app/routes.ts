import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

import { AUTH_ERROR_ROUTE } from "./lib/auth-paths";

export default [
  layout("routes/layout.tsx", [
    // The guarded layout has no path, so a profile lives at `/user/:username`
    // rather than below an `/app` prefix.
    layout("routes/app/layout.tsx", [
      index("routes/app/index.tsx"),
      route("user/:username", "routes/app/user.tsx"),
      route("settings", "routes/app/settings.tsx"),
    ]),

    route("onboard", "routes/onboard.tsx"),

    route(AUTH_ERROR_ROUTE, "routes/auth-error.tsx"),
  ]),
] satisfies RouteConfig;
