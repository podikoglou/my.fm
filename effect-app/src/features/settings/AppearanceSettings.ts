import { Command, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Select } from "@effect/ui-kit/Select";
import { Effect, Schema } from "effect";

import { getTheme, setTheme, themeOptions } from "../../../../app/app/lib/theme";

const Theme = Schema.Literals(themeOptions.map(({ value }) => value));

const Message = UiSchema.TaggedEnum({
  ChangedTheme: { theme: Theme },
  LoadedTheme: { theme: Theme },
  ToggledMenu: { open: Schema.Boolean },
});

const LoadTheme = Command.make("settings/LoadTheme", { args: {} }, () =>
  Effect.sync(() => Message.LoadedTheme({ theme: getTheme() })),
);

const ApplyTheme = Command.make("settings/ApplyTheme", { args: { theme: Theme } }, ({ theme }) =>
  Effect.sync(() => setTheme(theme)),
);

export const AppearanceSettings = Html.component({
  name: "AppearanceSettings",
  model: Schema.Struct({ theme: Theme, open: Schema.Boolean }),
  message: Message,
  restore: false,
}).make({
  init: ($) => $.set({ theme: "system", open: false }).run(LoadTheme.make()),
  update: {
    LoadedTheme: ($, { theme }) => $.evolve({ theme }),
    ToggledMenu: ($, { open }) => $.evolve({ open }),
    ChangedTheme: ($, { theme }) =>
      $.evolve({ theme }).run(ApplyTheme.make({ theme }).pipe(Command.asNoop)),
  },
  view: (h, { theme, open }) =>
    h.section
      .class("settings-section")
      .attr("aria-label", "Appearance")
      .children(
        h.h2("Appearance"),
        h.div.class("settings-group").children(
          Select(h, {
            props: { value: theme, open, items: themeOptions },
            onEmit: {
              RequestedOpen: () => Message.ToggledMenu({ open: true }),
              RequestedClose: () => Message.ToggledMenu({ open: false }),
              Picked: ({ value }) => {
                const option = themeOptions.find((entry) => entry.value === value);

                return option ? Message.ChangedTheme({ theme: option.value }) : undefined;
              },
              Settled: () => undefined,
            },
            view: (select) =>
              h.div.class("settings-row").children(
                select.label(h.div).children("Theme"),
                select.trigger(h.button.class("settings-select")).children(
                  select.value(h.span),
                  select.icon(h.span.class("settings-select-icon")).children(
                    h
                      .el("svg")
                      .attrs({
                        "aria-hidden": "true",
                        class: "size-4",
                        viewBox: "0 0 24 24",
                        fill: "none",
                        stroke: "currentColor",
                        "stroke-width": "2",
                        "stroke-linecap": "round",
                        "stroke-linejoin": "round",
                      })
                      .children(h.el("path").attr("d", "m6 9 6 6 6-6")),
                  ),
                ),
                select
                  .positioner(h.div.class("settings-select-positioner"))
                  .children(
                    select
                      .popup(h.div.class("settings-select-menu"))
                      .children(
                        themeOptions.map(({ value, label }) =>
                          select
                            .item({ element: h.div, value })
                            .children(
                              select.itemText(h.div).children(label),
                              select.itemIndicator({ element: h.span, value })?.children("✓"),
                            ),
                        ),
                      ),
                  ),
              ),
          }),
        ),
      ),
});
