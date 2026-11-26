import { type RouteConfig, index, route, layout } from "@react-router/dev/routes";

import { AUTH_ERROR_ROUTE } from "./lib/auth-paths";

export default [
  layout("routes/layout.tsx", [
    index("routes/index.tsx"),
    layout("routes/app-bar-layout.tsx", [
      route("feed", "routes/feed.tsx"),
      route("user/:username", "routes/app/user.tsx"),
      layout("routes/app/layout.tsx", [route("settings", "routes/app/settings.tsx")]),
    ]),

    route("onboard", "routes/onboard.tsx"),

    route(AUTH_ERROR_ROUTE, "routes/auth-error.tsx"),
  ]),
  route("oauth/authorize", "routes/oauth-authorize.tsx"),
] satisfies RouteConfig;
