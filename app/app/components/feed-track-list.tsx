import { useInfiniteQuery, type InfiniteData } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { parseResponse } from "hono/client";
import { ListMusic } from "lucide-react";
import { useEffect, useRef } from "react";

import { apiClient } from "~/lib/api";

import { ErrorCard } from "./error-card";
import { FeedTrack } from "./feed-track-card";

function fetchFeedPage(cursor: string | null) {
  return parseResponse(
    apiClient.feed.$get(
      { query: cursor ? { cursor } : {} },
      // The feed is the same for every viewer, so do not send a session.
      { init: { credentials: "omit" } },
    ),
  );
}

type FeedPage = Awaited<ReturnType<typeof fetchFeedPage>>;

export function FeedTrackList() {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery<
    FeedPage,
    Error,
    InfiniteData<FeedPage>,
    string[],
    string | null
  >({
    queryKey: ["feed"],
    queryFn: ({ pageParam }) => fetchFeedPage(pageParam),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage.nextCursor,
    retry: false,
  });

  useEffect(() => {
    if (!sentinelRef.current) return;

    observerRef.current = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      },
      { threshold: 0.1 },
    );

    observerRef.current.observe(sentinelRef.current);

    return () => {
      if (observerRef.current && sentinelRef.current) {
        observerRef.current.unobserve(sentinelRef.current);
      }
    };
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  if (error) {
    return (
      <ErrorCard
        Icon={ListMusic}
        title={<>Couldn't Load the Feed</>}
        description={<>We're not sure why</>}
      />
    );
  }

  if (!data) return <></>;

  const scrobbles = data.pages.flatMap((page) => page.items);

  if (scrobbles.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ListMusic className="h-10 w-10 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No scrobbles yet.</p>
      </div>
    );
  }

  return (
    <div className="h-full space-y-1 overflow-y-auto pr-1">
      {scrobbles.map((scrobble) => (
        <FeedTrack
          key={scrobble.id}
          user={scrobble.user}
          track={scrobble.track}
          album={scrobble.album}
          time={
            scrobble.scrobbleDate
              ? formatDistanceToNow(new Date(scrobble.scrobbleDate), { addSuffix: true })
              : null
          }
        />
      ))}
      <div ref={sentinelRef} className="h-1" />
    </div>
  );
}
