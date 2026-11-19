import { useQueries, useQuery, useQueryClient } from "@tanstack/react-query";
import { format, isToday } from "date-fns";
import { parseResponse } from "hono/client";
import { ListMusic } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";

import { apiClient } from "~/lib/api";

import { ErrorCard } from "./error-card";
import { Track } from "./track-card";

// A track row is 52px tall with a 4px gap below it. The list is laid out from
// this constant before any row loads, so it must match the rendered row.
const ROW_HEIGHT = 56;
const PAGE_SIZE = 8;
const OVERSCAN = 2;
const SETTLE_DELAY = 200;
const LABEL_HIDE_DELAY = 800;
const LABEL_HEIGHT = 24;

type Month = {
  key: string;
  label: string;
  shortLabel: string;
  start: number;
  count: number;
  // Unix seconds of local midnight on the 1st of the following month.
  before: number;
};

type Page = { month: Month; page: number };

function toMonths(counts: { month: string; count: number }[]) {
  let start = 0;

  return counts.map(({ month, count }): Month => {
    const [year, monthNumber] = month.split("-").map(Number);
    const first = new Date(year, monthNumber - 1, 1);

    const result = {
      key: month,
      label: format(first, "MMMM yyyy"),
      shortLabel: format(first, "MMM yyyy"),
      start,
      count,
      before: Math.floor(new Date(year, monthNumber, 1).getTime() / 1000),
    };

    start += count;

    return result;
  });
}

function monthAt(months: Month[], index: number) {
  let low = 0;
  let high = months.length - 1;

  while (low < high) {
    const middle = (low + high + 1) >> 1;

    if (months[middle].start <= index) low = middle;
    else high = middle - 1;
  }

  return months[low];
}

function pagesBetween(months: Month[], first: number, last: number) {
  const pages = new Map<string, Page>();

  for (let index = first; index <= last; index++) {
    const month = monthAt(months, index);
    const page = Math.floor((index - month.start) / PAGE_SIZE);
    pages.set(`${month.key}:${page}`, { month, page });
  }

  return [...pages.values()];
}

// The heading names the month at the top of the list, so a row from that month
// leaves it out. A row from an older month further down still names its own.
function formatScrobbleDate(date: Date, withMonth: boolean) {
  const time = date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });

  if (isToday(date)) return `Today, ${time}`;

  return `${format(date, withMonth ? "EEE d MMM" : "EEE d")}, ${time}`;
}

function TrackPlaceholder() {
  return (
    <div className="flex items-center gap-3 p-2" aria-hidden>
      <div className="h-9 w-9 shrink-0 rounded-md bg-muted" />
      <div className="flex-1 space-y-1.5">
        <div className="h-3 w-2/5 rounded bg-muted" />
        <div className="h-2.5 w-1/4 rounded bg-muted" />
      </div>
    </div>
  );
}

export function UserTrackList({ username }: { username: string }) {
  const queryClient = useQueryClient();
  const listRef = useRef<HTMLDivElement | null>(null);
  const settleTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const hideTimer = useRef<ReturnType<typeof setTimeout>>(undefined);

  const [scrollTop, setScrollTop] = useState(0);
  const [settledTop, setSettledTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(0);
  const [scrubbing, setScrubbing] = useState(false);

  const monthsQuery = useQuery({
    queryKey: ["scrobble-months", username],
    queryFn: async () =>
      toMonths(
        await parseResponse(
          apiClient.scrobble.getMonths.$get({
            query: { username, utcOffset: String(-new Date().getTimezoneOffset()) },
          }),
        ),
      ),
    retry: false,
  });

  const months = monthsQuery.data ?? [];
  const total = months.reduce((sum, month) => sum + month.count, 0);

  const fetchPage = ({ month, page }: Page) =>
    parseResponse(
      apiClient.scrobble.getRecent.$get({
        query: {
          username,
          before: String(month.before),
          offset: String(page * PAGE_SIZE),
          limit: String(PAGE_SIZE),
        },
      }),
    );

  // The count is part of the key, so a month that gains plays refetches its
  // pages instead of pairing the new count with rows cached before it.
  const pageKey = ({ month, page }: Page) => ["scrobbles", username, month.key, month.count, page];

  const rowsInView = (top: number) => ({
    first: Math.max(0, Math.floor(top / ROW_HEIGHT) - OVERSCAN),
    last: Math.min(total - 1, Math.floor((top + viewportHeight) / ROW_HEIGHT) + OVERSCAN),
  });

  // Rows load only once scrolling settles, so dragging the scrollbar across
  // years does not request every page it passes.
  const settledPages = useMemo(() => {
    if (total === 0 || viewportHeight === 0) return [];
    const { first, last } = rowsInView(settledTop);

    return pagesBetween(months, first, last);
  }, [months, total, settledTop, viewportHeight]);

  const pageQueries = useQueries({
    queries: settledPages.map((page) => ({
      queryKey: pageKey(page),
      queryFn: () => fetchPage(page),
      staleTime: 60_000,
      retry: false,
      // Rows read pages from the cache, so the list must re-render when a
      // page's data arrives even though only `error` is read from the result.
      notifyOnChangeProps: ["data", "error"] as const,
    })),
  });

  useEffect(() => {
    const list = listRef.current;

    if (!list) return;

    const observer = new ResizeObserver(() => setViewportHeight(list.clientHeight));
    observer.observe(list);

    return () => observer.disconnect();
  }, [total]);

  useEffect(
    () => () => {
      clearTimeout(settleTimer.current);
      clearTimeout(hideTimer.current);
    },
    [],
  );

  if (monthsQuery.error || pageQueries.some((query) => query.error)) {
    return (
      <ErrorCard
        Icon={ListMusic}
        title={<>Couldn't Find Scrobbles</>}
        description={<>We're not sure why</>}
      />
    );
  }

  if (!monthsQuery.data) return <></>;

  if (total === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ListMusic className="h-10 w-10 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No scrobbles yet.</p>
      </div>
    );
  }

  const onScroll = (top: number) => {
    setScrollTop(top);
    setScrubbing(true);

    clearTimeout(settleTimer.current);
    settleTimer.current = setTimeout(() => setSettledTop(top), SETTLE_DELAY);

    clearTimeout(hideTimer.current);
    hideTimer.current = setTimeout(() => setScrubbing(false), LABEL_HIDE_DELAY);
  };

  const { first, last } = rowsInView(scrollTop);
  const currentMonth = monthAt(months, Math.floor(scrollTop / ROW_HEIGHT));
  const settledMonth = monthAt(months, Math.floor(settledTop / ROW_HEIGHT));

  const list = listRef.current;
  const scrollable = list ? list.scrollHeight - list.clientHeight : 0;
  const progress = scrollable > 0 ? Math.min(1, scrollTop / scrollable) : 0;
  const labelTop = progress * Math.max(0, viewportHeight - LABEL_HEIGHT);

  const rows = [];

  for (let index = first; index <= last; index++) {
    const month = monthAt(months, index);
    const offset = index - month.start;

    const page = queryClient.getQueryData<Awaited<ReturnType<typeof fetchPage>>>(
      pageKey({ month, page: Math.floor(offset / PAGE_SIZE) }),
    );

    const scrobble = page?.[offset % PAGE_SIZE];
    const playedAt = scrobble?.scrobbleDate ? new Date(scrobble.scrobbleDate) : null;

    rows.push(
      <div
        key={scrobble?.id ?? `row-${index}`}
        className="absolute inset-x-0"
        style={{ top: index * ROW_HEIGHT }}
      >
        {scrobble ? (
          <Track
            artists={scrobble.track.artists}
            title={scrobble.track.name}
            imageUrl={scrobble.album.imageUrl}
            albumSpotifyUri={scrobble.album.spotifyUri}
            albumTitle={scrobble.album.name}
            trackSpotifyUri={scrobble.track.spotifyUri}
            extra={
              playedAt ? (
                <time
                  dateTime={playedAt.toISOString()}
                  title={format(playedAt, "PPPp")}
                  className="shrink-0 text-xs text-muted-foreground tabular-nums"
                >
                  {formatScrobbleDate(playedAt, month.key !== currentMonth.key)}
                </time>
              ) : null
            }
          />
        ) : (
          <TrackPlaceholder />
        )}
      </div>,
    );
  }

  return (
    <div className="relative h-full">
      <div
        ref={listRef}
        className="h-full overflow-y-auto pr-1"
        onScroll={(event) => onScroll(event.currentTarget.scrollTop)}
      >
        <h3 className="sticky top-0 z-10 h-7 bg-card text-xs leading-7 font-medium text-muted-foreground">
          {currentMonth.label}
        </h3>
        <div className="relative" style={{ height: total * ROW_HEIGHT }}>
          {rows}
        </div>
      </div>

      <div
        aria-hidden
        className="pointer-events-none absolute right-3 z-20 rounded-full border bg-card px-2.5 text-xs leading-[22px] font-medium shadow-sm transition-opacity duration-150 motion-reduce:transition-none"
        style={{ top: labelTop, opacity: scrubbing ? 1 : 0 }}
      >
        {currentMonth.shortLabel}
      </div>

      <p role="status" className="sr-only">
        {settledMonth.label}
      </p>
    </div>
  );
}
