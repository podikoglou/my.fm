import { Settings } from "lucide-react";
import { NavLink, useLocation } from "react-router";

import { useViewer } from "~/hooks/use-current-user";
import { signInWithSpotify } from "~/lib/auth-guard";

import { Button, buttonVariants } from "./ui/button";
import { UserAvatar } from "./user-avatar";

const profileLink = buttonVariants({
  variant: "ghost",
  className: "h-11 px-2 aria-[current=page]:bg-muted",
});

export function AppBar() {
  const { user, signedOut } = useViewer();
  const location = useLocation();

  return (
    <nav aria-label="App" className="mx-6 flex min-h-11 shrink-0 items-center gap-1 border-b pb-2">
      <NavLink
        to="/feed"
        aria-label="my.fm feed"
        title="Feed"
        className={buttonVariants({
          variant: "ghost",
          className: "-ms-2 me-auto h-11 px-2 text-xl font-bold tracking-tight",
        })}
      >
        my.fm
      </NavLink>

      {user && (
        <>
          <NavLink
            to={user.onboarded ? `/user/${user.username}` : "/onboard"}
            className={profileLink}
          >
            <span aria-hidden="true">
              <UserAvatar
                name={user.name}
                avatarUrl={user.avatarUrl}
                className="size-6"
                fallbackClassName="text-xs"
              />
            </span>
            My profile
          </NavLink>
          <NavLink
            to="/settings"
            aria-label="Settings"
            title="Settings"
            className={buttonVariants({
              variant: "ghost",
              size: "icon",
              className:
                "-me-2 size-11 text-muted-foreground aria-[current=page]:bg-muted aria-[current=page]:text-foreground",
            })}
          >
            <Settings aria-hidden="true" className="size-[18px]" />
          </NavLink>
        </>
      )}

      {signedOut && (
        <Button
          variant="ghost"
          className="h-11"
          onClick={() => signInWithSpotify(location.pathname)}
        >
          Sign in
        </Button>
      )}
    </nav>
  );
}
