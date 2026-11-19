import { ListMusic } from "lucide-react";

import { useScrobbleMonths } from "~/hooks/use-scrobble-months";

import { ErrorCard } from "./error-card";
import { HistoryTimeline } from "./history-timeline";

function ScrobblesError() {
  return (
    <ErrorCard
      Icon={ListMusic}
      title={<>Couldn't Find Scrobbles</>}
      description={<>We're not sure why</>}
    />
  );
}

export function UserTrackList({ username }: { username: string }) {
  const { data: months, error } = useScrobbleMonths(username);

  if (error) return <ScrobblesError />;

  if (!months) return <></>;

  if (months.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-center">
        <ListMusic className="h-10 w-10 text-muted-foreground opacity-50" />
        <p className="text-sm text-muted-foreground">No scrobbles yet.</p>
      </div>
    );
  }

  return <HistoryTimeline username={username} months={months} onError={ScrobblesError} />;
}
