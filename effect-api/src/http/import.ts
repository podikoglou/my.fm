import { Effect, Match, Stream } from "effect";
import { Multipart } from "effect/http";
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
import { Imports } from "../import/service.ts";

const GENERIC_SERVER_ERROR = "Something went wrong. Please try again.";

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
      .handle("upload", ({ payload }) =>
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

          let uploaded: { readonly filename: string; readonly bytes: Uint8Array } | undefined;

          yield* Stream.runForEach(payload, (part) => {
            if (uploaded === undefined && Multipart.isFile(part) && part.key === "file") {
              return Effect.map(part.contentEffect, (bytes) => {
                uploaded = { filename: part.name, bytes };
              });
            }

            return Multipart.isFile(part) ? Stream.runDrain(part.content) : Effect.void;
          }).pipe(
            Effect.catchTag("MultipartError", (error) =>
              Match.value(error.reason).pipe(
                Match.tags({
                  FileTooLarge: () =>
                    Effect.fail(
                      new ImportPayloadTooLargeError({ error: "File exceeds 10 MB limit" }),
                    ),
                  BodyTooLarge: () =>
                    Effect.fail(
                      new ImportPayloadTooLargeError({ error: "File exceeds 10 MB limit" }),
                    ),
                }),
                Match.orElse(() =>
                  Effect.fail(new ImportBadRequestError({ error: "Invalid multipart body" })),
                ),
              ),
            ),
          );

          if (uploaded === undefined) {
            return yield* new ImportBadRequestError({ error: "Missing CSV file" });
          }

          const { filename, bytes } = uploaded;

          const text = yield* Effect.try({
            try: () => new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes),
            catch: () => new ImportUnprocessableError({ error: "Invalid UTF-8 encoding" }),
          });

          return yield* imports
            .acceptUpload(user.id, {
              filename,
              text,
              bytes: bytes.slice().buffer,
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
