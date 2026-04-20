import { type RouteConfig, index, route, prefix, layout } from "@react-router/dev/routes";

export default [
  layout("routes/layout.tsx", [
    index("routes/home.tsx"),

    ...prefix("app", [
      layout("routes/app/layout.tsx", [
        index("routes/app/index.tsx"),
        route("user/:username", "routes/app/user.tsx"),
      ]),
    ]),

    route("onboard", "routes/onboard.tsx"),
  ]),
] satisfies RouteConfig;
