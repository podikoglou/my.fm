import { Effect } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import {
  CurrentUser,
  InternalServerError,
  InvalidOAuthApiRequestError,
  MyFmApi,
} from "../api/index.ts";
import { OAuthProviderService } from "../oauth/service.ts";

const toWebRequestUrl = Effect.fnUntraced(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest;
  const webRequest = yield* HttpServerRequest.toWeb(request).pipe(Effect.orDie);

  return webRequest.url;
});

export const OAuthHandlers = HttpApiBuilder.group(
  MyFmApi,
  "oauth",
  Effect.fnUntraced(function* (handlers) {
    const oauth = yield* OAuthProviderService;

    return handlers
      .handle("getAuthorize", () =>
        Effect.gen(function* () {
          const url = yield* toWebRequestUrl();

          return yield* oauth
            .getAuthorizeDetails(url)
            .pipe(
              Effect.catchTag("InvalidOAuthRequestError", () =>
                Effect.fail(new InvalidOAuthApiRequestError({ error: "Invalid OAuth request" })),
              ),
            );
        }),
      )
      .handle("decideAuthorize", ({ payload }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;
          const url = yield* toWebRequestUrl();

          return yield* oauth.decideAuthorize(url, user.id, payload).pipe(
            Effect.catchTags({
              InvalidOAuthRequestError: () =>
                Effect.fail(new InvalidOAuthApiRequestError({ error: "Invalid OAuth request" })),
              OAuthProviderError: () =>
                Effect.fail(new InvalidOAuthApiRequestError({ error: "Invalid OAuth request" })),
            }),
          );
        }),
      )
      .handle("listApps", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const apps = yield* oauth
            .listApps(user.id)
            .pipe(
              Effect.catchTag("OAuthProviderError", () =>
                Effect.fail(new InternalServerError({ error: "Failed to list OAuth apps" })),
              ),
            );

          return { apps };
        }),
      )
      .handle("revokeApp", ({ params }) =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          return yield* oauth
            .revokeApp(params.id, user.id)
            .pipe(
              Effect.catchTag("OAuthProviderError", () =>
                Effect.fail(new InternalServerError({ error: "Failed to revoke OAuth app" })),
              ),
            );
        }),
      );
  }),
);
