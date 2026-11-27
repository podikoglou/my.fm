import type { ProjectedScrobbleSchema } from "@my.fm/api";
import type { Html } from "@effect/ui/html";
import { format } from "date-fns";

import { formatScrobbleDate, ROW_HEIGHT } from "./history-timeline";
import { Track } from "./Track";

export type HistoryScrobble = typeof ProjectedScrobbleSchema.Type;

function ScrobbleTime<M>(h: Html.H<M>, date: Date, withMonth: boolean) {
  return h.time
    .attrs({
      datetime: date.toISOString(),
      title: format(date, "PPPp"),
      class: "shrink-0 text-xs text-muted-foreground tabular-nums",
    })
    .children(formatScrobbleDate(date, withMonth));
}

function TrackPlaceholder<M>(h: Html.H<M>) {
  return h.div
    .attrs({ "aria-hidden": "true", class: "flex items-center gap-3 p-2" })
    .children(
      h.div
        .attr("data-slot", "skeleton")
        .class("h-9 w-9 shrink-0 animate-pulse rounded-md bg-accent"),
      h.div
        .class("flex-1 space-y-1.5")
        .children(
          h.div.attr("data-slot", "skeleton").class("h-3 w-2/5 animate-pulse rounded-md bg-accent"),
          h.div
            .attr("data-slot", "skeleton")
            .class("h-2.5 w-1/4 animate-pulse rounded-md bg-accent"),
        ),
    );
}

export function HistoryRow<M>(
  h: Html.H<M>,
  options: {
    readonly index: number;
    readonly scrobble: HistoryScrobble | undefined;
    readonly withMonth: boolean;
  },
) {
  const { index, scrobble, withMonth } = options;

  return h.div
    .key(scrobble?.id ?? `row-${index}`)
    .class("absolute inset-x-0")
    .style({ top: `${index * ROW_HEIGHT}px` })
    .children(
      scrobble
        ? Track(h, {
            artists: scrobble.track.artists,
            title: scrobble.track.name,
            imageUrl: scrobble.album.imageUrl,
            albumSpotifyUri: scrobble.album.spotifyUri,
            albumTitle: scrobble.album.name,
            trackSpotifyUri: scrobble.track.spotifyUri,
            extra: scrobble.scrobbleDate
              ? ScrobbleTime(h, new Date(scrobble.scrobbleDate), withMonth)
              : undefined,
          })
        : TrackPlaceholder(h),
    );
}
