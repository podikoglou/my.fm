import { useQueries, useQueryClient } from "@tanstack/react-query";
import { parseResponse } from "hono/client";

import { apiClient } from "~/lib/api";
import { type HistoryPage, type Month, PAGE_SIZE, rowAddress } from "~/lib/history-timeline";

function fetchHistoryPage(username: string, { month, page }: HistoryPage) {
  return parseResponse(
    apiClient.scrobble.getRecent.$get({
      query: {
        username,
        before: String(month.before),
        offset: String(page * PAGE_SIZE),
        limit: String(PAGE_SIZE),
      },
    }),
  );
}

export type HistoryScrobble = Awaited<ReturnType<typeof fetchHistoryPage>>[number];

// The count is part of the key, so a month that gains plays refetches its
// pages instead of pairing the new count with rows cached before it.
function historyPageKey(username: string, { month, page }: HistoryPage) {
  return ["scrobbles", username, month.key, month.count, page];
}

/**
 * Load `pages` and look up any row already in the cache, including rows from
 * pages loaded earlier that are no longer requested.
 */
export function useHistoryPages(username: string, months: Month[], pages: HistoryPage[]) {
  const queryClient = useQueryClient();

  const queries = useQueries({
    queries: pages.map((page) => ({
      queryKey: historyPageKey(username, page),
      queryFn: () => fetchHistoryPage(username, page),
      staleTime: 60_000,
      retry: false,
      // Rows are read from the cache by `scrobbleAt`, so the caller must
      // re-render when a page's data arrives, not only when `error` changes.
      notifyOnChangeProps: ["data", "error"] as const,
    })),
  });

  const scrobbleAt = (index: number) => {
    const { month, page, slot } = rowAddress(months, index);

    return queryClient.getQueryData<HistoryScrobble[]>(historyPageKey(username, { month, page }))?.[
      slot
    ];
  };

  return { failed: queries.some((query) => query.error), scrobbleAt };
}
