import { type RouteConfig, index, route, prefix, layout } from "@react-router/dev/routes";

export default [
  index("routes/home.tsx"),

  ...prefix("app", [layout("routes/app/layout.tsx", [index("routes/app/index.tsx")])]),
  ...prefix("auth", [route("spotify/callback", "routes/auth/spotify/callback.tsx")]),
] satisfies RouteConfig;
