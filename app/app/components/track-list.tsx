import { Track } from "./track-card";

export function TrackList({
  tracks,
}: {
  tracks: {
    artist: string;
    title: string;
    age: string;
  }[];
}) {
  return (
    <div className="h-full space-y-1 overflow-y-auto pr-1">
      {tracks.map((track) => (
        <Track
          {...track}
          extra={<span className="shrink-0 text-xs text-muted-foreground">{track.age}</span>}
        />
      ))}
    </div>
  );
}
