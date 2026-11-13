import { Music } from "lucide-react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export function FeedTrack({
  user,
  track,
  time,
}: {
  user: { username: string; name: string };
  track: { name: string; imageUrl: string; artists: string[] };
  time: string | null;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
      <Avatar className="h-9 w-9 rounded-md">
        <AvatarImage src={track.imageUrl} />
        <AvatarFallback>
          <Music className="h-4 w-4 text-muted-foreground" />
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="truncate text-xs text-muted-foreground">
          <Link
            to={`/user/${user.username}`}
            className="font-medium text-foreground hover:underline"
          >
            {user.name}
          </Link>{" "}
          listened to {track.artists.join(", ")}
        </p>
        <p className="truncate text-xs font-medium">{track.name}</p>
      </div>

      {time ? <span className="shrink-0 text-xs text-muted-foreground">{time}</span> : null}
    </div>
  );
}
