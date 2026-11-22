import { authorizationErrorRedirect, type OAuthHelpers } from "@cloudflare/workers-oauth-provider";
import { Context, Effect, Layer, Option, Schema } from "effect";

import { InvalidOAuthRequestError, OAuthProviderError } from "./errors.ts";

const GrantMetadataSchema = Schema.Struct({
  label: Schema.optional(Schema.String),
});

const decodeGrantMetadata = Schema.decodeUnknownOption(GrantMetadataSchema);

export interface OAuthClientSummary {
  readonly clientId: string;
  readonly clientName: string | undefined;
  readonly clientUri: string | undefined;
}

export interface OAuthAuthorizeDetails {
  readonly client: OAuthClientSummary;
  readonly scope: ReadonlyArray<string>;
  readonly redirectUri: string;
}

export interface OAuthDecideInput {
  readonly decision: "allow" | "deny";
  readonly query: string;
}

export interface OAuthApp {
  readonly id: string;
  readonly clientId: string;
  readonly name: string;
  readonly clientUri: string | undefined;
  readonly scope: ReadonlyArray<string>;
  readonly createdAt: number;
}

export interface OAuthProviderApi {
  readonly getAuthorizeDetails: (
    requestUrl: string,
  ) => Effect.Effect<OAuthAuthorizeDetails, InvalidOAuthRequestError>;
  readonly decideAuthorize: (
    requestUrl: string,
    userId: string,
    input: OAuthDecideInput,
  ) => Effect.Effect<
    { readonly redirectTo: string },
    InvalidOAuthRequestError | OAuthProviderError
  >;
  readonly listApps: (userId: string) => Effect.Effect<ReadonlyArray<OAuthApp>, OAuthProviderError>;
  readonly revokeApp: (
    grantId: string,
    userId: string,
  ) => Effect.Effect<{ readonly success: true }, OAuthProviderError>;
}

const authorizeRequest = (requestUrl: string, query: string) => {
  const url = new URL("/oauth/authorize", requestUrl);

  url.search = query;

  return new Request(url.href);
};

export class OAuthProviderService extends Context.Service<OAuthProviderService, OAuthProviderApi>()(
  "@my.fm/effect-api/oauth/OAuthProviderService",
) {
  static readonly layerFromHelpers = (helpers: OAuthHelpers): Layer.Layer<OAuthProviderService> =>
    Layer.succeed(
      OAuthProviderService,
      (() => {
        const parseAndLookup = Effect.fn("OAuthProviderService.parseAndLookup")(function* (
          requestUrl: string,
          query: string,
        ) {
          const authRequest = yield* Effect.tryPromise({
            try: () => helpers.parseAuthRequest(authorizeRequest(requestUrl, query)),
            catch: () => new InvalidOAuthRequestError({ message: "Invalid OAuth request" }),
          });

          const client = yield* Effect.tryPromise({
            try: () => helpers.lookupClient(authRequest.clientId),
            catch: () => new InvalidOAuthRequestError({ message: "Invalid OAuth request" }),
          });

          if (!client) {
            return yield* new InvalidOAuthRequestError({ message: "Invalid OAuth request" });
          }

          return { authRequest, client };
        });

        const getAuthorizeDetails = Effect.fn("OAuthProviderService.getAuthorizeDetails")(
          function* (requestUrl: string) {
            const { authRequest, client } = yield* parseAndLookup(
              requestUrl,
              new URL(requestUrl).search,
            );

            return {
              client: {
                clientId: client.clientId,
                clientName: client.clientName,
                clientUri: client.clientUri,
              },
              scope: authRequest.scope,
              redirectUri: authRequest.redirectUri,
            };
          },
        );

        const decideAuthorize = Effect.fn("OAuthProviderService.decideAuthorize")(function* (
          requestUrl: string,
          userId: string,
          input: OAuthDecideInput,
        ) {
          const { authRequest, client } = yield* parseAndLookup(requestUrl, input.query);

          if (input.decision === "deny") {
            return {
              redirectTo: authorizationErrorRedirect(authRequest, "access_denied"),
            };
          }

          const { redirectTo } = yield* Effect.tryPromise({
            try: () =>
              helpers.completeAuthorization({
                request: authRequest,
                userId,
                metadata: { label: client.clientName },
                scope: ["read"],
                props: { userId },
              }),
            catch: (cause) => new OAuthProviderError({ operation: "completeAuthorization", cause }),
          });

          return { redirectTo };
        });

        const listApps = Effect.fn("OAuthProviderService.listApps")(function* (userId: string) {
          const grants = yield* Effect.tryPromise({
            try: () => helpers.listUserGrants(userId),
            catch: (cause) => new OAuthProviderError({ operation: "listUserGrants", cause }),
          });

          const apps = yield* Effect.forEach(
            grants.items,
            Effect.fnUntraced(function* (grant) {
              const client = yield* Effect.tryPromise({
                try: () => helpers.lookupClient(grant.clientId),
                catch: () => null,
              }).pipe(Effect.orElseSucceed(() => null));

              const metadata = decodeGrantMetadata(grant.metadata);

              const fallbackLabel = Option.getOrUndefined(
                Option.map(metadata, (value) => value.label),
              );

              return {
                id: grant.id,
                clientId: grant.clientId,
                name: client?.clientName ?? fallbackLabel ?? grant.clientId,
                clientUri: client?.clientUri,
                scope: grant.scope,
                createdAt: grant.createdAt,
              } satisfies OAuthApp;
            }),
            { concurrency: "unbounded" },
          );

          return [...apps].toSorted((a, b) => b.createdAt - a.createdAt);
        });

        const revokeApp = Effect.fn("OAuthProviderService.revokeApp")(function* (
          grantId: string,
          userId: string,
        ) {
          yield* Effect.tryPromise({
            try: () => helpers.revokeGrant(grantId, userId),
            catch: (cause) => new OAuthProviderError({ operation: "revokeGrant", cause }),
          });

          return { success: true as const };
        });

        return OAuthProviderService.of({
          getAuthorizeDetails,
          decideAuthorize,
          listApps,
          revokeApp,
        });
      })(),
    );

  static readonly unavailableLayer: Layer.Layer<OAuthProviderService> = Layer.succeed(
    OAuthProviderService,
    OAuthProviderService.of({
      getAuthorizeDetails: () =>
        Effect.fail(new InvalidOAuthRequestError({ message: "Invalid OAuth request" })),
      decideAuthorize: () =>
        Effect.fail(
          new OAuthProviderError({
            operation: "decideAuthorize",
            cause: new Error("OAuthProviderService is not configured"),
          }),
        ),
      listApps: () =>
        Effect.fail(
          new OAuthProviderError({
            operation: "listApps",
            cause: new Error("OAuthProviderService is not configured"),
          }),
        ),
      revokeApp: () =>
        Effect.fail(
          new OAuthProviderError({
            operation: "revokeApp",
            cause: new Error("OAuthProviderService is not configured"),
          }),
        ),
    }),
  );
}
