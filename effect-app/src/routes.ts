import { Route } from "@effect/ui";
import { Schema } from "effect";

export const AppRoute = Route.union({
  Index: Route.make("/"),
  Feed: Route.make("/feed"),
  User: Route.make("/user/:username", { params: { username: Schema.String } }),
  Settings: Route.make("/settings"),
  Onboard: Route.make("/onboard", { search: { returnTo: Schema.optional(Schema.String) } }),
  AuthError: Route.make("/auth/error", { search: { error: Schema.optional(Schema.String) } }),
  OAuthAuthorize: Route.make("/oauth/authorize"),
  NotFound: Route.make("/*"),
});
