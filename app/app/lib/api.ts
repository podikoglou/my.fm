import { MyFmApi } from "@my.fm/effect-api";
import { Cause, Effect, Exit, Layer, Option, Predicate } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

const authenticatedHttpLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })),
);

const publicHttpLayer = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "omit" })),
);

export const apiClient = Effect.runSync(
  HttpApiClient.make(MyFmApi).pipe(Effect.provide(authenticatedHttpLayer)),
);

export const publicApiClient = Effect.runSync(
  HttpApiClient.make(MyFmApi).pipe(Effect.provide(publicHttpLayer)),
);

const authenticatedHttpClient = Effect.runSync(
  Effect.gen(function* () {
    return yield* HttpClient.HttpClient;
  }).pipe(Effect.provide(authenticatedHttpLayer)),
);

const decodeImportUpload = HttpApiClient.decodeResponse(MyFmApi, {
  group: "import",
  endpoint: "upload",
});

export function uploadImportFile(file: File) {
  const formData = new FormData();
  formData.append("file", file);

  const request = HttpClientRequest.post("/api/import").pipe(
    HttpClientRequest.bodyFormData(formData),
  );

  return authenticatedHttpClient.execute(request).pipe(Effect.flatMap(decodeImportUpload));
}

export async function runApi<A, E>(effect: Effect.Effect<A, E>): Promise<A> {
  const exit = await Effect.runPromiseExit(effect);

  if (Exit.isSuccess(exit)) {
    return exit.value;
  }

  const failure = Cause.findErrorOption(exit.cause);
  const value = Option.isSome(failure) ? failure.value : Cause.squash(exit.cause);

  if (value instanceof Error) {
    throw value;
  }

  const message =
    Predicate.isObject(value) && "error" in value && Predicate.isString(value.error)
      ? value.error
      : "API request failed";

  throw Object.assign(new Error(message), { error: message });
}
