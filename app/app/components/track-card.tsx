import { Music } from "lucide-react";
import type { ReactNode } from "react";
import { Avatar, AvatarFallback, AvatarImage } from "./ui/avatar";

export function Track({
  artist,
  title,
  extra,
  imageUrl,
}: {
  artist: string;
  title: string;
  extra?: ReactNode;
  imageUrl?: string;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
      <Avatar className="h-9 w-9 rounded-md">
        <AvatarImage src={imageUrl} />
        <AvatarFallback>
          <Music className="h-4 w-4 text-muted-foreground" />
        </AvatarFallback>
      </Avatar>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{artist}</p>
      </div>

      <div>{extra}</div>
    </div>
  );
}
