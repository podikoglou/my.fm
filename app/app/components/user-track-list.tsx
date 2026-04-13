import { useInfiniteQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { useEffect, useRef } from "react";
import { apiClient } from "~/lib/api";
import { ErrorCard } from "./error-card";
import { Track } from "./track-card";

export function UserTrackList({ username }: { username: string }) {
  const observerRef = useRef<IntersectionObserver | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const { data, error, hasNextPage, fetchNextPage, isFetchingNextPage } = useInfiniteQuery({
    queryKey: ["scrobbles", username],
    queryFn: ({ pageParam = 0 }) =>
      parseResponse(
        apiClient.scrobble.getRecent.$get({
          query: { username, limit: "8", offset: pageParam.toString() },
        }),
      ),
    initialPageParam: 0,
    getNextPageParam: (lastPage, allPages) => {
      if (lastPage.length < 8) return undefined;
      return allPages.length * 8;
    },
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
        icon={<></>}
        title={<>Couldn't Find Scrobbles</>}
        description={<>We're not sure why</>}
      />
    );
  }

  if (!data) return <></>;

  const allScrobbles = data.pages.flat();

  return (
    <>
      <div className="h-full overflow-y-auto space-y-1 pr-1">
        {allScrobbles.map((scrobble) => (
          <Track
            artist={scrobble.album.name}
            title={scrobble.track.name}
            imageUrl={scrobble.album.imageUrl}
            extra={<span className="text-xs text-muted-foreground shrink-0">{4}</span>}
          />
        ))}
        <div ref={sentinelRef} className="h-1" />
      </div>
    </>
  );
}
