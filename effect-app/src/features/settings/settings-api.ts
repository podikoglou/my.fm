import { MyFmApi } from "@my.fm/api";
import { Effect, Layer } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";
import { HttpApiClient } from "effect/http-api";

const authenticatedHttp = FetchHttpClient.layer.pipe(
  Layer.provide(Layer.succeed(FetchHttpClient.RequestInit, { credentials: "include" })),
);

const decodeUpload = HttpApiClient.decodeResponse(MyFmApi, {
  group: "import",
  endpoint: "upload",
});

export const uploadImport = Effect.fnUntraced(function* (file: File) {
  const body = new FormData();

  body.append("file", file);

  const request = HttpClientRequest.post("/api/import").pipe(HttpClientRequest.bodyFormData(body));
  const response = yield* HttpClient.execute(request).pipe(Effect.provide(authenticatedHttp));

  return yield* decodeUpload(response);
});
