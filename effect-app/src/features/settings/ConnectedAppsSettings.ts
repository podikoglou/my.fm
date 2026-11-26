import { Command, Component, Query, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Button } from "@effect/ui-kit/Button";
import { Dialog } from "@effect/ui-kit/Dialog";
import { OAuthAppSchema } from "@my.fm/api";
import { formatDistance } from "date-fns";
import { Clock, Effect, Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { agentOnboardingInstructions } from "../../../../app/app/lib/agents-instructions";
import { apiClient } from "../../lib/api";

const ConnectedApp = Schema.Struct({ app: OAuthAppSchema, connectedAgo: Schema.String });

const Message = UiSchema.TaggedEnum({
  RequestedRevoke: { id: Schema.String },
  RevokedApp: { id: Schema.String },
  FailedRevoke: { id: Schema.String },
  OpenedAgentDialog: {},
  LoadedInstructions: { text: Schema.String },
  ClosedAgentDialog: {},
  RequestedCopy: {},
  FinishedCopy: { copied: Schema.Boolean },
});

function appLink(uri: string | undefined) {
  if (!uri || !/^https?:\/\//i.test(uri)) return undefined;

  try {
    const { protocol } = new URL(uri);

    return protocol === "https:" || protocol === "http:" ? uri : undefined;
  } catch {
    return undefined;
  }
}

class ConnectedApps extends Query.Service<ConnectedApps>()("settings/ConnectedApps", {
  args: { userId: Schema.String },
  success: Schema.Array(ConnectedApp),
  error: Schema.String,
  staleTime: "0 seconds",
}) {
  static readonly layer = this.toLayer(() =>
    Effect.gen(function* () {
      const { apps } = yield* apiClient.oauth.listApps();
      const now = yield* Clock.currentTimeMillis;

      return apps.map((app) => ({
        app,
        connectedAgo: formatDistance(app.createdAt * 1000, now, { addSuffix: true }),
      }));
    }).pipe(Effect.mapError(() => "Could not load your connected apps.")),
  );
}

const RevokeApp = Command.make(
  "settings/RevokeConnectedApp",
  { args: { userId: Schema.String, id: Schema.String }, mode: "concurrent" },
  ({ userId, id }) =>
    apiClient.oauth.revokeApp({ params: { id } }).pipe(
      Effect.tap(() => ConnectedApps.invalidate({ userId })),
      Effect.match({
        onSuccess: () => Message.RevokedApp({ id }),
        onFailure: () => Message.FailedRevoke({ id }),
      }),
    ),
);

const ReadInstructions = Command.make("settings/ReadAgentInstructions", { args: {} }, () =>
  Effect.sync(() =>
    Message.LoadedInstructions({ text: agentOnboardingInstructions(window.location.origin) }),
  ),
);

const Copy = Command.make(
  "settings/CopyAgentInstructions",
  { args: { text: Schema.String } },
  ({ text }) =>
    Effect.tryPromise(() => navigator.clipboard.writeText(text)).pipe(
      Effect.match({
        onSuccess: () => Message.FinishedCopy({ copied: true }),
        onFailure: () => Message.FinishedCopy({ copied: false }),
      }),
    ),
);

export const ConnectedAppsSettings = Html.component({
  name: "ConnectedAppsSettings",
  props: Schema.Struct({ userId: Schema.String }),
  model: Schema.Struct({
    pendingIds: Schema.Array(Schema.String),
    failedIds: Schema.Array(Schema.String),
    revokedIds: Schema.Array(Schema.String),
    dialogOpen: Schema.Boolean,
    instructions: Schema.String,
    copyStatus: Schema.Literals(["idle", "copying", "copied", "failed"]),
  }),
  message: Message,
  restore: false,
  queries: {
    apps: { query: ConnectedApps, args: ({ props: { userId } }) => ({ userId }) },
  },
})
  .make({
    init: () => ({
      pendingIds: [],
      failedIds: [],
      revokedIds: [],
      dialogOpen: false,
      instructions: "",
      copyStatus: "idle",
    }),
    update: {
      RequestedRevoke: ($, { id }) =>
        $.model.pendingIds.includes(id)
          ? $.model
          : $.evolve({
              pendingIds: [...$.model.pendingIds, id],
              failedIds: $.model.failedIds.filter((failedId) => failedId !== id),
            }).run(RevokeApp.make({ userId: $.props.userId, id })),
      RevokedApp: ($, { id }) =>
        $.evolve({
          revokedIds: [...$.model.revokedIds, id],
          pendingIds: $.model.pendingIds.filter((pendingId) => pendingId !== id),
        }),
      FailedRevoke: ($, { id }) =>
        $.evolve({
          pendingIds: $.model.pendingIds.filter((pendingId) => pendingId !== id),
          failedIds: [...$.model.failedIds, id],
        }),
      OpenedAgentDialog: ($) =>
        $.evolve({ dialogOpen: true, copyStatus: "idle" }).run(ReadInstructions.make()),
      LoadedInstructions: ($, { text }) => $.evolve({ instructions: text }),
      ClosedAgentDialog: ($) => $.evolve({ dialogOpen: false }).run(Command.interrupt(Copy)),
      RequestedCopy: ($) =>
        $.model.instructions && $.model.copyStatus !== "copying"
          ? $.evolve({ copyStatus: "copying" }).run(Copy.make({ text: $.model.instructions }))
          : $.model,
      FinishedCopy: ($, { copied }) => $.evolve({ copyStatus: copied ? "copied" : "failed" }),
    },
    view: (h, model) =>
      Dialog(h, {
        props: { open: model.dialogOpen },
        onEmit: {
          RequestedOpen: () => Message.OpenedAgentDialog(),
          RequestedClose: () => Message.ClosedAgentDialog(),
          Settled: () => undefined,
        },
        view: (dialog) =>
          h.section
            .class("settings-section")
            .attr("aria-label", "Connected apps")
            .children(
              h.h2("Connected apps"),
              h.div.class("settings-group").children(
                h.div
                  .class("settings-row")
                  .children(
                    h.div(
                      dialog.trigger(h.button).class("settings-link").children("Connect an agent"),
                      h.p(
                        "Add the my.fm MCP server to Claude, OpenCode or another client. Access is read-only.",
                      ),
                    ),
                  ),
                AsyncResult.getOrElse(h.queries.apps, () => [])
                  .filter(({ app }) => !model.revokedIds.includes(app.id))
                  .map(({ app, connectedAgo }) => {
                    const href = appLink(app.clientUri);
                    const revoking = model.pendingIds.includes(app.id);

                    return h.div
                      .key(app.id)
                      .class("settings-row")
                      .children(
                        h.div(
                          h.div
                            .class("settings-app-label")
                            .children(
                              href
                                ? h.a
                                    .attrs({ href, target: "_blank", rel: "noopener noreferrer" })
                                    .children(app.name)
                                : h.span(app.name),
                              h.span.class("settings-badge").children("Read-only"),
                            ),
                          h.p(`Connected ${connectedAgo}.`),
                          h.div
                            .attr("role", "status")
                            .class("settings-error")
                            .children(
                              model.failedIds.includes(app.id)
                                ? "Could not revoke access. Please try again."
                                : null,
                            ),
                        ),
                        Button(h, {
                          props: { disabled: revoking, focusableWhenDisabled: true },
                          onPress: Message.RequestedRevoke({ id: app.id }),
                        })
                          .class("settings-button settings-revoke")
                          .children(revoking ? "Revoking..." : "Revoke"),
                      );
                  }),
              ),
              dialog.portal(h.dialog)?.children(
                dialog.backdrop(h.div.class("settings-dialog-backdrop")),
                dialog.viewport(h.div.class("settings-dialog-viewport")).children(
                  dialog.popup(h.div.class("settings-dialog")).children(
                    dialog.title(h.h3).children("Connect an agent"),
                    dialog
                      .description(h.p)
                      .children(
                        "Paste this into your agent. The first request opens a browser window where you allow access.",
                      ),
                    h.pre.attr("tabindex", "0").children(model.instructions),
                    h.div.class("settings-dialog-actions").children(
                      h.div
                        .attr("role", "status")
                        .class("settings-detail")
                        .children(
                          model.copyStatus === "copied"
                            ? "Copied to clipboard."
                            : model.copyStatus === "failed"
                              ? h.span
                                  .class("settings-error")
                                  .children("Copy failed. Select the text instead.")
                              : null,
                        ),
                      Button(h, {
                        props: { disabled: !model.instructions || model.copyStatus === "copying" },
                        onPress: Message.RequestedCopy(),
                      })
                        .class("settings-button")
                        .children(model.copyStatus === "copied" ? "Copied" : "Copy"),
                      dialog
                        .close(h.button)
                        .class("settings-button settings-primary")
                        .children("Done"),
                    ),
                  ),
                ),
              ),
            ),
      }),
  })
  .pipe(Component.provide(ConnectedApps.layer));
