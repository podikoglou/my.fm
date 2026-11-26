import { Link, useSearchParams } from "react-router";

import { FeedTrackList } from "~/components/feed-track-list";
import { buttonVariants } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { UserAvatar } from "~/components/user-avatar";
import { useFeedViewer } from "~/hooks/use-current-user";
import { cn } from "~/lib/utils";

export function meta() {
  return [{ title: "Feed · my.fm" }];
}

export default function FeedPage() {
  const viewer = useFeedViewer();
  const [params] = useSearchParams();
  const showName = import.meta.env.DEV && params.get("profile") === "name";

  return (
    <>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="text-3xl font-bold">Feed</CardTitle>
          {viewer && (
            <Link
              to={viewer.onboarded ? `/user/${viewer.username}` : "/onboard"}
              aria-label={`${viewer.name}, ${viewer.onboarded ? "your profile" : "set up your profile"}`}
              className={cn(
                buttonVariants({ variant: "ghost" }),
                "-me-1.5 -my-1 h-11 max-w-1/2 rounded-full px-1.5",
              )}
            >
              {showName && <span className="truncate">{viewer.name}</span>}
              <UserAvatar
                avatarUrl={viewer.avatarUrl}
                name={viewer.name}
                className="size-8"
                fallbackClassName="text-xs"
              />
            </Link>
          )}
        </div>
        <CardDescription className="mt-2">The latest scrobbles from everyone.</CardDescription>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden">
        <FeedTrackList />
      </CardContent>
    </>
  );
}
