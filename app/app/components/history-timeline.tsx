import { useHistoryPages } from "~/hooks/use-history-pages";
import { useSettledScroll } from "~/hooks/use-settled-scroll";
import {
  type Month,
  monthAt,
  pagesBetween,
  ROW_HEIGHT,
  rowsInView,
  totalPlays,
} from "~/lib/history-timeline";

import { HistoryRow } from "./history-row";
import { ScrobblesError } from "./scrobbles-error";
import { ScrollMonthLabel } from "./scroll-month-label";

/**
 * A virtual list as tall as the whole history, so the native scrollbar spans
 * every play. Rows load only once scrolling settles, so dragging across years
 * does not request every page it passes.
 */
export function HistoryTimeline({ username, months }: { username: string; months: Month[] }) {
  const { ref, onScroll, ...scroll } = useSettledScroll();
  const total = totalPlays(months);

  const settledPages =
    scroll.viewportHeight === 0
      ? []
      : pagesBetween(months, rowsInView(scroll.settledTop, scroll.viewportHeight, total));

  const { failed, scrobbleAt } = useHistoryPages(username, months, settledPages);

  if (failed) return <ScrobblesError />;

  const { first, last } = rowsInView(scroll.scrollTop, scroll.viewportHeight, total);
  const currentMonth = monthAt(months, Math.floor(scroll.scrollTop / ROW_HEIGHT));
  const settledMonth = monthAt(months, Math.floor(scroll.settledTop / ROW_HEIGHT));

  const rows = [];

  for (let index = first; index <= last; index++) {
    const scrobble = scrobbleAt(index);

    rows.push(
      <HistoryRow
        key={scrobble?.id ?? `row-${index}`}
        index={index}
        scrobble={scrobble}
        withMonth={monthAt(months, index).key !== currentMonth.key}
      />,
    );
  }

  return (
    <div className="relative h-full">
      <div ref={ref} className="history-scroll h-full overflow-y-auto pr-1" onScroll={onScroll}>
        <h3 className="sticky top-0 z-10 h-7 bg-card text-xs leading-7 font-medium text-muted-foreground">
          {currentMonth.label}
        </h3>
        <div className="relative" style={{ height: total * ROW_HEIGHT }}>
          {rows}
        </div>
      </div>

      <ScrollMonthLabel
        label={currentMonth.shortLabel}
        progress={scroll.progress}
        viewportHeight={scroll.viewportHeight}
        visible={scroll.scrolling}
      />

      <p role="status" className="sr-only">
        {settledMonth.label}
      </p>
    </div>
  );
}
