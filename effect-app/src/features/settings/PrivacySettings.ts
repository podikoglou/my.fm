import { Command, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Switch } from "@effect/ui-kit/Switch";
import { Effect, Schema } from "effect";

import { apiClient } from "../../lib/api";

const Message = UiSchema.TaggedEnum({
  ChangedPrivacy: { isPrivate: Schema.Boolean },
  SavedPrivacy: { isPrivate: Schema.Boolean },
  FailedPrivacy: {},
});

export const PrivacyEvents = UiSchema.TaggedEnum({
  SavedPrivacy: { isPrivate: Schema.Boolean },
});

const SavePrivacy = Command.make(
  "settings/SavePrivacy",
  { args: { isPrivate: Schema.Boolean } },
  (payload) =>
    apiClient.user.updateSettings({ payload }).pipe(
      Effect.match({
        onSuccess: Message.SavedPrivacy,
        onFailure: () => Message.FailedPrivacy(),
      }),
    ),
);

export const PrivacySettings = Html.component({
  name: "PrivacySettings",
  props: Schema.Struct({ isPrivate: Schema.Boolean }),
  model: Schema.Struct({
    isPrivate: Schema.Boolean,
    pending: Schema.NullOr(Schema.Boolean),
    failed: Schema.Boolean,
  }),
  message: Message,
  events: PrivacyEvents,
  restore: false,
}).make({
  init: ({ props }) => ({ isPrivate: props.isPrivate, pending: null, failed: false }),
  update: {
    ChangedPrivacy: ($, { isPrivate }) =>
      $.model.pending === null
        ? $.evolve({ pending: isPrivate, failed: false }).run(SavePrivacy.make({ isPrivate }))
        : $.model,
    SavedPrivacy: ($, { isPrivate }) =>
      $.evolve({ isPrivate, pending: null }).emit(PrivacyEvents.SavedPrivacy({ isPrivate })),
    FailedPrivacy: ($) => $.evolve({ pending: null, failed: true }),
  },
  view: (h, model) =>
    h.section
      .class("settings-section")
      .attr("aria-label", "Privacy")
      .children(
        h.h2("Privacy"),
        h.div.class("settings-group").children(
          h.div.class("settings-row").children(
            h.div(
              h.label.attr("for", "isPrivate").children("Private profile"),
              h.p
                .attr("id", "isPrivate-description")
                .children("Only you can see your profile and your listening history."),
              h.div
                .attr("role", "status")
                .class("settings-error")
                .children(model.failed ? "Could not save your settings. Please try again." : null),
            ),
            Switch(h, {
              props: {
                checked: model.pending ?? model.isPrivate,
                disabled: model.pending !== null,
              },
              onToggle: ({ checked }) => Message.ChangedPrivacy({ isPrivate: checked }),
              view: (parts) =>
                parts
                  .root(
                    h.button
                      .attrs({ id: "isPrivate", "aria-describedby": "isPrivate-description" })
                      .class("settings-switch"),
                  )
                  .children(parts.thumb(h.span.class("settings-thumb"))),
            }),
          ),
        ),
      ),
});
