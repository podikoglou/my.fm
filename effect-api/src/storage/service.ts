import type { R2Bucket, R2Object, R2ObjectBody, R2PutOptions } from "@cloudflare/workers-types";

import { Context, Effect, Layer, Schema } from "effect";

export class ImportsStorageError extends Schema.TaggedError<
  ImportsStorageError,
  { readonly brand: unique symbol }
>()("ImportsStorageError", {
  operation: Schema.Literals(["get", "put", "delete", "head"]),
  key: Schema.String,
  message: Schema.String,
}) {}

function toMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}

function makeImportsStorageService(bucket: R2Bucket): ImportsStorage["Service"] {
  const get = (key: string): Effect.Effect<R2ObjectBody | null, ImportsStorageError> =>
    Effect.tryPromise({
      try: () => bucket.get(key),
      catch: (cause) =>
        new ImportsStorageError({
          operation: "get",
          key,
          message: toMessage(cause),
        }),
    });

  const put = (
    key: string,
    value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
    options?: R2PutOptions,
  ): Effect.Effect<R2Object | null, ImportsStorageError> =>
    Effect.tryPromise({
      try: () => bucket.put(key, value, options),
      catch: (cause) =>
        new ImportsStorageError({
          operation: "put",
          key,
          message: toMessage(cause),
        }),
    });

  const remove = (key: string): Effect.Effect<void, ImportsStorageError> =>
    Effect.tryPromise({
      try: () => bucket.delete(key),
      catch: (cause) =>
        new ImportsStorageError({
          operation: "delete",
          key,
          message: toMessage(cause),
        }),
    });

  const head = (key: string): Effect.Effect<R2Object | null, ImportsStorageError> =>
    Effect.tryPromise({
      try: () => bucket.head(key),
      catch: (cause) =>
        new ImportsStorageError({
          operation: "head",
          key,
          message: toMessage(cause),
        }),
    });

  return ImportsStorage.of({
    get,
    put,
    delete: remove,
    head,
  });
}

export class ImportsStorage extends Context.Service<
  ImportsStorage,
  {
    readonly get: (key: string) => Effect.Effect<R2ObjectBody | null, ImportsStorageError>;
    readonly put: (
      key: string,
      value: string | ArrayBuffer | ArrayBufferView | ReadableStream,
      options?: R2PutOptions,
    ) => Effect.Effect<R2Object | null, ImportsStorageError>;
    readonly delete: (key: string) => Effect.Effect<void, ImportsStorageError>;
    readonly head: (key: string) => Effect.Effect<R2Object | null, ImportsStorageError>;
  }
>()("@my.fm/effect-api/storage/ImportsStorage") {
  static readonly layerFromBinding = (bucket: R2Bucket): Layer.Layer<ImportsStorage> =>
    Layer.sync(ImportsStorage, () => makeImportsStorageService(bucket));
}
