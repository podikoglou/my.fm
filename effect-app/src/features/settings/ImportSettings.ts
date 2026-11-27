import { Command, Component, Query, UiSchema } from "@effect/ui";
import { Html, HtmlFiles } from "@effect/ui/html";
import { Button } from "@effect/ui-kit/Button";
import { ImportStatusSchema } from "@my.fm/api";
import { Effect, Option, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { importErrorMessage } from "../../../../app/app/lib/import-error-message";
import { apiClient } from "../../lib/api";
import { uploadImport } from "./settings-api";

const ImportSummary = Schema.Struct({
  status: ImportStatusSchema,
  processedRows: Schema.Finite,
  error: Schema.NullOr(Schema.String),
});

const FileSchema = Schema.instanceOf(File);

const Message = UiSchema.TaggedEnum({
  RequestedImport: {},
  ChoseFiles: { files: Schema.Array(FileSchema) },
  AcceptedUpload: {},
  FailedUpload: { error: Schema.String },
});

class LatestImport extends Query.Service<LatestImport>()("settings/LatestImport", {
  args: { userId: Schema.String },
  success: Schema.NullOr(ImportSummary),
  error: Schema.String,
  staleTime: "0 seconds",
  refetchInterval: (result) => {
    const status = Option.getOrNull(AsyncResult.value(result))?.status;

    return status === "pending" || status === "processing" ? "15 seconds" : undefined;
  },
}) {
  static readonly layer = this.toLayer(() =>
    apiClient.import.latest().pipe(
      Effect.map(({ import: entry }) =>
        entry
          ? {
              status: entry.status,
              processedRows: entry.processedRows,
              error: entry.error,
            }
          : null,
      ),
      Effect.mapError(() => "Could not load the latest import."),
    ),
  );
}

const Upload = Command.make(
  "settings/UploadImport",
  { args: { userId: Schema.String, file: FileSchema } },
  ({ userId, file }) =>
    uploadImport(file).pipe(
      Effect.tap(() => LatestImport.invalidate({ userId })),
      Effect.match({
        onSuccess: () => Message.AcceptedUpload(),
        onFailure: (error) =>
          Message.FailedUpload({
            error:
              error instanceof Error
                ? importErrorMessage(error)
                : "Import failed. Please try again.",
          }),
      }),
    ),
);

export const ImportSettings = Html.component({
  name: "ImportSettings",
  props: Schema.Struct({ userId: Schema.String }),
  model: Schema.Struct({
    uploading: Schema.Boolean,
    accepted: Schema.Boolean,
    error: Schema.NullOr(Schema.String),
  }),
  message: Message,
  restore: false,
  queries: {
    latest: {
      query: LatestImport,
      args: ({ props: { userId } }) => ({ userId }),
    },
  },
})
  .make({
    init: () => ({ uploading: false, accepted: false, error: null }),
    update: {
      RequestedImport: ($) =>
        $.model.uploading
          ? $.model
          : $.run(
              HtmlFiles.pick(({ files }) => Message.ChoseFiles({ files }), { accept: [".csv"] }),
            ),
      ChoseFiles: ($, { files: [file] }) =>
        file && !$.model.uploading
          ? $.evolve({ uploading: true, accepted: false, error: null }).run(
              Upload.make({ userId: $.props.userId, file }),
            )
          : $.model,
      AcceptedUpload: ($) => $.evolve({ uploading: false, accepted: true }),
      FailedUpload: ($, { error }) => $.evolve({ uploading: false, error }),
    },
    view: (h, { uploading, accepted, error }) => {
      const latest = Option.getOrNull(AsyncResult.value(h.queries.latest));

      return h.section
        .class("settings-section")
        .attr("aria-label", "Data")
        .children(
          h.h2("Data"),
          h.div.class("settings-group").children(
            h.div.class("settings-row").children(
              h.div(
                h.span("Import listening history"),
                h.p("Upload a listening history CSV export (up to 10 MB)."),
                h.div
                  .class("settings-import-status")
                  .attr("role", "status")
                  .children(
                    latest
                      ? h.p
                          .class("settings-detail")
                          .children(
                            `Status: ${latest.status}${latest.processedRows > 0 ? ` (${latest.processedRows} plays processed)` : ""}`,
                          )
                      : null,
                    latest?.status === "failed"
                      ? h.p
                          .class("settings-error")
                          .children(latest.error ?? "Import failed. Please try again.")
                      : null,
                    accepted
                      ? h.p("File accepted. Ingestion will process in the background.")
                      : null,
                    error ? h.p.class("settings-error").children(error) : null,
                  ),
              ),
              Button(h, { props: { disabled: uploading }, onPress: Message.RequestedImport() })
                .class("settings-button")
                .children(uploading ? "Uploading..." : "Import"),
            ),
          ),
        );
    },
  })
  .pipe(Component.provide(LatestImport.layer));
