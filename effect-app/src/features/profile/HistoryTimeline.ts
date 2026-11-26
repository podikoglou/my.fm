import { Component, Mount, UiSchema } from "@effect/ui";
import { Html } from "@effect/ui/html";
import { Effect, Option, Queue, Schema, Stream } from "effect";
import { AsyncResult } from "effect/reactivity";

import { HistoryRow } from "./HistoryRow";
import {
  type HistoryPage,
  historyPageId,
  monthAt,
  MonthSchema,
  pagesBetween,
  ROW_HEIGHT,
  rowAddress,
  rowsInView,
  totalPlays,
} from "./history-timeline";
import { ScrobblesError } from "./ProfileErrorCard";
import { GetHistoryPage } from "./queries";
import { ScrollMonthLabel } from "./ScrollMonthLabel";

const SETTLE_DELAY = 200;
const LABEL_HIDE_DELAY = 800;

export const TimelineScrollEvent = UiSchema.TaggedEnum({
  Measured: { viewportHeight: Schema.Finite, scrollHeight: Schema.Finite },
  Scrolled: {
    scrollTop: Schema.Finite,
    viewportHeight: Schema.Finite,
    scrollHeight: Schema.Finite,
  },
  Settled: { settledTop: Schema.Finite },
  HidLabel: {},
});

export type TimelineScrollEvent = typeof TimelineScrollEvent.Type;

export const ObserveTimelineScroll = Mount.makeStream(
  "ObserveTimelineScroll",
  { args: {} },
  (node: HTMLElement) =>
    Stream.callback<TimelineScrollEvent>((queue) =>
      Effect.acquireRelease(
        Effect.sync(() => {
          let settleTimer: ReturnType<typeof setTimeout> | undefined;
          let hideTimer: ReturnType<typeof setTimeout> | undefined;

          const measure = () => {
            Queue.offerUnsafe(
              queue,
              TimelineScrollEvent.Measured({
                viewportHeight: node.clientHeight,
                scrollHeight: node.scrollHeight,
              }),
            );
          };

          const onScroll = () => {
            const top = node.scrollTop;

            Queue.offerUnsafe(
              queue,
              TimelineScrollEvent.Scrolled({
                scrollTop: top,
                viewportHeight: node.clientHeight,
                scrollHeight: node.scrollHeight,
              }),
            );

            clearTimeout(settleTimer);
            settleTimer = setTimeout(() => {
              Queue.offerUnsafe(queue, TimelineScrollEvent.Settled({ settledTop: top }));
            }, SETTLE_DELAY);

            clearTimeout(hideTimer);
            hideTimer = setTimeout(() => {
              Queue.offerUnsafe(queue, TimelineScrollEvent.HidLabel());
            }, LABEL_HIDE_DELAY);
          };

          const resizeObserver =
            typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);

          resizeObserver?.observe(node);
          node.addEventListener("scroll", onScroll, { passive: true });
          measure();

          return () => {
            resizeObserver?.disconnect();
            node.removeEventListener("scroll", onScroll);
            clearTimeout(settleTimer);
            clearTimeout(hideTimer);
          };
        }),
        (cleanup) => Effect.sync(cleanup),
      ),
    ),
);

function recordSettledKeys(
  loadedKeys: readonly string[],
  months: readonly (typeof MonthSchema.Type)[],
  settledTop: number,
  viewportHeight: number,
): readonly string[] {
  if (viewportHeight === 0) return loadedKeys;
  const total = totalPlays(months);

  if (total === 0) return loadedKeys;

  const settled = pagesBetween(months, rowsInView(settledTop, viewportHeight, total));
  const existing = new Set(loadedKeys);
  const additions: string[] = [];

  for (const page of settled) {
    const id = historyPageId(page);

    if (!existing.has(id)) {
      existing.add(id);
      additions.push(id);
    }
  }

  return additions.length === 0 ? loadedKeys : [...loadedKeys, ...additions];
}

export const HistoryTimelineProps = Schema.Struct({
  username: Schema.String,
  months: Schema.Array(MonthSchema),
});

export const HistoryTimelineModel = Schema.Struct({
  scrollTop: Schema.Finite,
  settledTop: Schema.Finite,
  viewportHeight: Schema.Finite,
  scrollHeight: Schema.Finite,
  scrolling: Schema.Boolean,
  loadedKeys: Schema.Array(Schema.String),
});

export const HistoryTimelineMessage = UiSchema.TaggedEnum({
  MeasuredViewport: { viewportHeight: Schema.Finite, scrollHeight: Schema.Finite },
  ScrolledList: {
    scrollTop: Schema.Finite,
    viewportHeight: Schema.Finite,
    scrollHeight: Schema.Finite,
  },
  SettledScroll: { settledTop: Schema.Finite },
  HidScrollLabel: {},
});

function toMessage(event: TimelineScrollEvent) {
  return TimelineScrollEvent.match(event, {
    Measured: ({ viewportHeight, scrollHeight }) =>
      HistoryTimelineMessage.MeasuredViewport({ viewportHeight, scrollHeight }),
    Scrolled: ({ scrollTop, viewportHeight, scrollHeight }) =>
      HistoryTimelineMessage.ScrolledList({ scrollTop, viewportHeight, scrollHeight }),
    Settled: ({ settledTop }) => HistoryTimelineMessage.SettledScroll({ settledTop }),
    HidLabel: () => HistoryTimelineMessage.HidScrollLabel(),
  });
}

export const HistoryTimelineNoDeps = Html.component({
  name: "HistoryTimeline",
  props: HistoryTimelineProps,
  model: HistoryTimelineModel,
  message: HistoryTimelineMessage,
  restore: false,
  queries: {
    pages: {
      queryMany: GetHistoryPage,
      args: ({ model, props }) => {
        if (model.viewportHeight === 0) return [];

        const total = totalPlays(props.months);

        if (total === 0) return [];

        const settled = pagesBetween(
          props.months,
          rowsInView(model.settledTop, model.viewportHeight, total),
        );

        const visible = pagesBetween(
          props.months,
          rowsInView(model.scrollTop, model.viewportHeight, total),
        );

        const loaded = new Set(model.loadedKeys);
        const pages = new Map<string, HistoryPage>();

        for (const page of settled) {
          pages.set(historyPageId(page), page);
        }

        for (const page of visible) {
          const id = historyPageId(page);

          if (loaded.has(id) && !pages.has(id)) {
            pages.set(id, page);
          }
        }

        return [...pages.values()].map(({ month, page }) => ({
          username: props.username,
          monthKey: month.key,
          monthCount: month.count,
          before: month.before,
          page,
        }));
      },
    },
  },
}).make({
  init: () => ({
    scrollTop: 0,
    settledTop: 0,
    viewportHeight: 0,
    scrollHeight: 0,
    scrolling: false,
    loadedKeys: [],
  }),
  update: {
    MeasuredViewport: ($, { viewportHeight, scrollHeight }) =>
      $.evolve({
        viewportHeight,
        scrollHeight,
        loadedKeys: (keys) =>
          recordSettledKeys(keys, $.props.months, $.model.settledTop, viewportHeight),
      }),
    ScrolledList: ($, { scrollTop, viewportHeight, scrollHeight }) =>
      $.evolve({
        scrollTop,
        viewportHeight,
        scrollHeight,
        scrolling: true,
      }),
    SettledScroll: ($, { settledTop }) =>
      $.evolve({
        settledTop,
        loadedKeys: (keys) =>
          recordSettledKeys(keys, $.props.months, settledTop, $.model.viewportHeight),
      }),
    HidScrollLabel: ($) => $.evolve({ scrolling: false }),
  },
  view: (h, model) => {
    if (h.queries.pages.some((entry) => AsyncResult.isFailure(entry.result))) {
      return ScrobblesError(h);
    }

    const { months, username } = h.props;
    const total = totalPlays(months);
    const { first, last } = rowsInView(model.scrollTop, model.viewportHeight, total);
    const currentMonth = monthAt(months, Math.floor(model.scrollTop / ROW_HEIGHT));
    const settledMonth = monthAt(months, Math.floor(model.settledTop / ROW_HEIGHT));

    const scrollable = model.scrollHeight - model.viewportHeight;
    const progress = scrollable > 0 ? Math.min(1, model.scrollTop / scrollable) : 0;

    const rows = [];

    for (let index = first; index <= last; index++) {
      const { month, page, slot } = rowAddress(months, index);

      const entry = h.queries.pages.get({
        username,
        monthKey: month.key,
        monthCount: month.count,
        before: month.before,
        page,
      });

      const scrobble =
        Option.isSome(entry) && AsyncResult.isSuccess(entry.value.result)
          ? entry.value.result.value[slot]
          : undefined;

      rows.push(
        HistoryRow(h, {
          index,
          scrobble,
          withMonth: month.key !== currentMonth.key,
        }),
      );
    }

    return h.div.class("relative h-full").children(
      h.div
        .class("timeline-scroll h-full overflow-y-auto pr-1")
        .onMount(ObserveTimelineScroll().pipe(Mount.map(toMessage)))
        .children(
          h.h3
            .class(
              "sticky top-0 z-10 h-7 bg-card text-xs leading-7 font-medium text-muted-foreground",
            )
            .children(currentMonth.label),
          h.div
            .class("relative")
            .style({ height: `${total * ROW_HEIGHT}px` })
            .children(rows),
        ),
      ScrollMonthLabel(h, {
        label: currentMonth.shortLabel,
        progress,
        viewportHeight: model.viewportHeight,
        visible: model.scrolling,
      }),
      h.p.attr("role", "status").class("sr-only").children(settledMonth.label),
    );
  },
});

export const HistoryTimeline = HistoryTimelineNoDeps.pipe(Component.provide(GetHistoryPage.layer));
