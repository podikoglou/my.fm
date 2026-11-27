import { MyFmApi } from "@my.fm/api";
import { Effect, Layer } from "effect";
import { FetchHttpClient } from "effect/http";
import { HttpApiClient } from "effect/http-api";

function makeClient(credentials: RequestCredentials) {
  return Effect.runSync(
    HttpApiClient.make(MyFmApi).pipe(
      Effect.provide(
        FetchHttpClient.layer.pipe(
          Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials })),
        ),
      ),
    ),
  );
}

export const apiClient = makeClient("include");

// The public feed must not vary with the viewer's session cookie.
export const publicApiClient = makeClient("omit");
