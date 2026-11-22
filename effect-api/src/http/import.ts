import { Effect, Predicate } from "effect";
import { HttpServerRequest } from "effect/http";
import { HttpApiBuilder } from "effect/http-api";

import {
  CurrentUser,
  ImportBadRequestError,
  ImportConflictError,
  ImportPayloadTooLargeError,
  ImportTooManyRequestsError,
  ImportUnprocessableError,
  InternalServerError,
  MyFmApi,
  ServiceUnavailableError,
} from "../api/index.ts";
import { MAX_FILE_SIZE_BYTES } from "../import/csv.ts";
import { Imports } from "../import/service.ts";

const GENERIC_SERVER_ERROR = "Something went wrong. Please try again.";

type UploadedFile = {
  readonly name: string;
  readonly size: number;
  arrayBuffer(): Promise<ArrayBuffer>;
};

function isUploadedFile(value: unknown): value is UploadedFile {
  return (
    Predicate.isObject(value) &&
    "arrayBuffer" in value &&
    Predicate.isFunction(value.arrayBuffer) &&
    "name" in value &&
    Predicate.isString(value.name) &&
    "size" in value &&
    Predicate.isNumber(value.size)
  );
}

export const ImportHandlers = HttpApiBuilder.group(
  MyFmApi,
  "import",
  Effect.fn(function* (handlers) {
    const imports = yield* Imports;

    return handlers
      .handle("latest", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          const latest = yield* imports.latestForUser(user.id).pipe(
            Effect.catchTags({
              D1QuotaExceededError: (error) =>
                Effect.fail(new ServiceUnavailableError({ error: error.message })),
              D1QueryError: () =>
                Effect.fail(new InternalServerError({ error: GENERIC_SERVER_ERROR })),
            }),
          );

          return { import: latest ?? null };
        }),
      )
      .handle("upload", () =>
        Effect.gen(function* () {
          const user = yield* CurrentUser;

          yield* imports.checkUploadEligibility(user.id).pipe(
            Effect.catchTags({
              ImportInProgressError: (error) =>
                Effect.fail(new ImportConflictError({ error: error.error })),
              ImportRateLimitError: (error) =>
                Effect.fail(new ImportTooManyRequestsError({ error: error.error })),
              D1QuotaExceededError: (error) =>
                Effect.fail(new ServiceUnavailableError({ error: error.message })),
              D1QueryError: () =>
                Effect.fail(new InternalServerError({ error: GENERIC_SERVER_ERROR })),
            }),
          );

          const request = yield* HttpServerRequest.HttpServerRequest;
          const contentLength = request.headers["content-length"];

          if (contentLength && Number(contentLength) > MAX_FILE_SIZE_BYTES) {
            return yield* new ImportPayloadTooLargeError({
              error: "File exceeds 10 MB limit",
            });
          }

          const webRequest = yield* HttpServerRequest.toWeb(request).pipe(
            Effect.mapError(() => new ImportBadRequestError({ error: "Invalid multipart body" })),
          );

          const formData = yield* Effect.tryPromise({
            try: () => webRequest.formData(),
            catch: () => new ImportBadRequestError({ error: "Invalid multipart body" }),
          });

          const entry: unknown = formData.get("file");

          if (!isUploadedFile(entry)) {
            return yield* new ImportBadRequestError({ error: "Missing CSV file" });
          }

          if (entry.size > MAX_FILE_SIZE_BYTES) {
            return yield* new ImportPayloadTooLargeError({
              error: "File exceeds 10 MB limit",
            });
          }

          const bytes = yield* Effect.tryPromise({
            try: () => entry.arrayBuffer(),
            catch: () => new ImportBadRequestError({ error: "Invalid multipart body" }),
          });

          const text = yield* Effect.try({
            try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
            catch: () => new ImportUnprocessableError({ error: "Invalid UTF-8 encoding" }),
          });

          return yield* imports
            .acceptUpload(user.id, {
              filename: entry.name,
              text,
              bytes,
            })
            .pipe(
              Effect.catchTags({
                ImportInProgressError: (error) =>
                  Effect.fail(new ImportConflictError({ error: error.error })),
                ImportValidationError: (error) =>
                  Effect.fail(new ImportUnprocessableError({ error: error.error })),
                D1QuotaExceededError: (error) =>
                  Effect.fail(new ServiceUnavailableError({ error: error.message })),
                D1QueryError: () =>
                  Effect.fail(new InternalServerError({ error: GENERIC_SERVER_ERROR })),
                ImportsStorageError: () =>
                  Effect.fail(new InternalServerError({ error: GENERIC_SERVER_ERROR })),
              }),
            );
        }),
      );
  }),
);
