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
    <div className="h-full overflow-y-auto space-y-1 pr-1">
      {tracks.map((track) => (
        <Track
          {...track}
          extra={<span className="text-xs text-muted-foreground shrink-0">{track.age}</span>}
        />
      ))}
    </div>
  );
}
