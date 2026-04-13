import { Music } from "lucide-react";
import type { ReactNode } from "react";

export function Track({
  artist,
  title,
  extra,
}: {
  artist: string;
  title: string;
  extra?: ReactNode;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg p-2 hover:bg-muted/50">
      <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted">
        <Music className="h-4 w-4 text-muted-foreground" />
      </div>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium truncate">{title}</p>
        <p className="text-xs text-muted-foreground truncate">{artist}</p>
      </div>

      <div>{extra}</div>
    </div>
  );
}
