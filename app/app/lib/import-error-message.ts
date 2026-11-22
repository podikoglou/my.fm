import {
  ImportBadRequestError,
  ImportConflictError,
  ImportPayloadTooLargeError,
  ImportTooManyRequestsError,
  ImportUnprocessableError,
  InternalServerError,
  ServiceUnavailableError,
} from "@my.fm/effect-api";
import { HttpClientError } from "effect/http";

function isImportApiError(
  error: Error,
): error is
  | ImportBadRequestError
  | ImportConflictError
  | ImportPayloadTooLargeError
  | ImportTooManyRequestsError
  | ImportUnprocessableError
  | InternalServerError
  | ServiceUnavailableError {
  return (
    error instanceof ImportBadRequestError ||
    error instanceof ImportConflictError ||
    error instanceof ImportPayloadTooLargeError ||
    error instanceof ImportTooManyRequestsError ||
    error instanceof ImportUnprocessableError ||
    error instanceof InternalServerError ||
    error instanceof ServiceUnavailableError
  );
}

export function importErrorMessage(error: Error): string {
  if (isImportApiError(error)) {
    return error.error || "Import failed. Please try again.";
  }

  if (HttpClientError.isHttpClientError(error) && error.reason._tag === "StatusCodeError") {
    return "Import failed. Please try again.";
  }

  return "Network error during upload.";
}
