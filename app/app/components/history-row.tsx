import { format } from "date-fns";

import type { HistoryScrobble } from "~/hooks/use-history-pages";

import { formatScrobbleDate, ROW_HEIGHT } from "~/lib/history-timeline";

import { Track } from "./track-card";

function ScrobbleTime({ date, withMonth }: { date: Date; withMonth: boolean }) {
  return (
    <time
      dateTime={date.toISOString()}
      title={format(date, "PPPp")}
      className="shrink-0 text-xs text-muted-foreground tabular-nums"
    >
      {formatScrobbleDate(date, withMonth)}
    </time>
  );
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

/** One slot of the history list: the scrobble once its page has loaded, a placeholder until then. */
export function HistoryRow({
  index,
  scrobble,
  withMonth,
}: {
  index: number;
  scrobble?: HistoryScrobble;
  withMonth: boolean;
}) {
  return (
    <div className="absolute inset-x-0" style={{ top: index * ROW_HEIGHT }}>
      {scrobble ? (
        <Track
          artists={scrobble.track.artists}
          title={scrobble.track.name}
          imageUrl={scrobble.album.imageUrl}
          albumSpotifyUri={scrobble.album.spotifyUri}
          albumTitle={scrobble.album.name}
          trackSpotifyUri={scrobble.track.spotifyUri}
          extra={
            scrobble.scrobbleDate ? (
              <ScrobbleTime date={new Date(scrobble.scrobbleDate)} withMonth={withMonth} />
            ) : null
          }
        />
      ) : (
        <TrackPlaceholder />
      )}
    </div>
  );
}
