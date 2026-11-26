import { ArrowRight } from "lucide-react";
import { Link } from "react-router";

import { FeedTrackList } from "~/components/feed-track-list";
import { buttonVariants } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { useSignedInUser } from "~/hooks/use-current-user";

export function meta() {
  return [{ title: "Feed · my.fm" }];
}

export default function FeedPage() {
  const user = useSignedInUser();

  return (
    <>
      <CardHeader>
        <CardTitle className="text-3xl font-bold">Feed</CardTitle>
        <CardDescription className="mt-2">
          {user ? (
            <>
              {user.onboarded && "Signed in as "}
              <Link
                to={user.onboarded ? `/user/${user.username}` : "/onboard"}
                aria-label={user.onboarded ? `@${user.username}, your profile` : undefined}
                className={buttonVariants({
                  variant: "link",
                  size: "sm",
                  className: "-my-1 h-7 gap-1 px-0 align-baseline underline underline-offset-4",
                })}
              >
                {user.onboarded ? `@${user.username}` : "Set up your profile"}
                <ArrowRight aria-hidden="true" className="size-3 rtl:rotate-180" />
              </Link>
            </>
          ) : (
            "The latest scrobbles from everyone."
          )}
        </CardDescription>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden">
        <FeedTrackList />
      </CardContent>
    </>
  );
}
