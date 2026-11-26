import { ChevronRight, Disc3 } from "lucide-react";
import { Link } from "react-router";

import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { CardFooter } from "~/components/ui/card";
import { useSignedInUser } from "~/hooks/use-current-user";
import { useLastListen } from "~/hooks/use-last-listen";

export function LastListenLink() {
  const user = useSignedInUser();
  const listen = useLastListen(user);

  if (!user) return null;

  const fallbackTitle = user.onboarded ? "Listening history" : "Set up your profile";

  return (
    <CardFooter className="shrink-0 border-t [.border-t]:pt-3">
      <Link
        to={user.onboarded ? `/user/${user.username}` : "/onboard"}
        className="flex w-full min-w-0 items-center gap-3 rounded-lg p-2 hover:bg-muted/50 focus-visible:outline-2 focus-visible:outline-ring"
      >
        <Avatar className="size-9 rounded-md" aria-hidden="true">
          {listen?.album.imageUrl && <AvatarImage src={listen.album.imageUrl} alt="" />}
          <AvatarFallback className="rounded-md">
            <Disc3 className="size-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs text-muted-foreground">
            {listen ? "Your last listen" : user.name}
          </span>
          <span className="block truncate text-sm font-medium">
            {listen?.track.name ?? fallbackTitle}
          </span>
        </span>
        <span className="flex shrink-0 items-center gap-1 text-xs text-muted-foreground">
          {listen && "History"}
          <ChevronRight aria-hidden="true" className="size-4" />
        </span>
      </Link>
    </CardFooter>
  );
}
