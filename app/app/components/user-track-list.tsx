import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { apiClient } from "~/lib/api";
import { ErrorCard } from "./error-card";
import { Track } from "./track-card";

export function UserTrackList({ username }: { username: string }) {
  const { data, error } = useQuery({
    queryKey: ["scrobbles", username, 8, 0],
    queryFn: () =>
      parseResponse(
        apiClient.scrobble.getRecent.$get({ query: { username, limit: "8", offset: "0" } }),
      ),
    retry: false,
  });

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

  return (
    <>
      <div className="h-full overflow-y-auto space-y-1 pr-1">
        {data.map((scrobble) => (
          <Track
            artist={scrobble.album.name}
            title={scrobble.track.name}
            imageUrl={scrobble.album.imageUrl}
            extra={<span className="text-xs text-muted-foreground shrink-0">{4}</span>}
          />
        ))}
      </div>
    </>
  );
}
