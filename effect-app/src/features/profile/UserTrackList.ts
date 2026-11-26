import { Component } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Schema } from "effect";
import { AsyncResult } from "effect/reactivity";

import { icon } from "../../components/icon";
import { HistoryTimeline } from "./HistoryTimeline";
import { ScrobblesError } from "./ProfileErrorCard";
import { GetScrobbleMonths } from "./queries";

export const UserTrackListProps = Schema.Struct({
  username: Schema.String,
});

export const UserTrackListNoDeps = Html.component({
  name: "UserTrackList",
  props: UserTrackListProps,
  model: Schema.Struct({}),
  message: Schema.Never,
  restore: false,
  queries: {
    months: {
      query: GetScrobbleMonths,
      args: ({ props }) => ({ username: props.username }),
    },
  },
}).make({
  init: () => ({}),
  update: {},
  view: (h) =>
    AsyncResult.match(h.queries.months, {
      onInitial: () => h.div,
      onFailure: () => ScrobblesError(h),
      onSuccess: ({ value: months }) =>
        months.length === 0
          ? h.div
              .class("flex h-full flex-col items-center justify-center gap-2 text-center")
              .children(
                icon(h, "listMusic", "h-10 w-10 text-muted-foreground opacity-50"),
                h.p.class("text-sm text-muted-foreground").children("No scrobbles yet."),
              )
          : HistoryTimeline(h, {
              key: h.props.username,
              props: { username: h.props.username, months },
            }),
    }),
});

export const UserTrackList = UserTrackListNoDeps.pipe(Component.provide(GetScrobbleMonths.layer));
