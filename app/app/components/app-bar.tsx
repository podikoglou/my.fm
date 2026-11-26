import { House, LogIn, type LucideIcon, Settings, UserRound } from "lucide-react";
import { NavLink, useLocation, type NavLinkProps } from "react-router";

import { useViewer } from "~/hooks/use-current-user";
import { signInWithSpotify } from "~/lib/auth-guard";

import { Button } from "./ui/button";

function AppBarLink({
  to,
  label,
  icon: Icon,
}: Pick<NavLinkProps, "to"> & {
  label: string;
  icon: LucideIcon;
}) {
  return (
    <NavLink
      to={to}
      end
      aria-label={label}
      title={label}
      className="group grid min-h-11 place-items-center rounded-lg text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-foreground aria-[current=page]:text-foreground"
    >
      <span className="grid h-8 w-14 place-items-center rounded-full group-hover:bg-muted/50 group-aria-[current=page]:bg-muted">
        <Icon aria-hidden="true" className="size-5 group-aria-[current=page]:stroke-[2.5]" />
      </span>
    </NavLink>
  );
}

export function AppBar() {
  const { user, signedOut } = useViewer();
  const location = useLocation();

  return (
    <nav
      aria-label="App"
      className="grid shrink-0 auto-cols-fr grid-flow-col border-t bg-card px-2 pt-1 pb-[max(0.25rem,env(safe-area-inset-bottom))]"
    >
      <AppBarLink to="/feed" label="Feed" icon={House} />

      {user && (
        <>
          <AppBarLink
            to={user.onboarded ? `/user/${user.username}` : "/onboard"}
            label="My profile"
            icon={UserRound}
          />
          <AppBarLink to="/settings" label="Settings" icon={Settings} />
        </>
      )}

      {signedOut && (
        <Button
          variant="ghost"
          className="h-11 text-muted-foreground"
          aria-label="Sign in"
          title="Sign in"
          onClick={() => signInWithSpotify(location.pathname)}
        >
          <LogIn aria-hidden="true" className="size-5" />
        </Button>
      )}
    </nav>
  );
}
