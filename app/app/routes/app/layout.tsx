import { getDefaultStore } from "jotai";
import { Outlet, redirect } from "react-router";
import { apiClient } from "~/lib/api";
import { parseResponse } from "hono/client";
import { queryClient } from "~/lib/query";
import { authorizeSpotify } from "~/lib/spotify";
import { accessTokenAtom } from "~/state/auth";
import { Card } from "~/components/ui/card";

// NOTE: this loader should be almost identical with the loader in ../onboard.tsx (just with the opposite logic)
export async function clientLoader() {
  const store = getDefaultStore();

  // ensure we've got an access token
  const accessToken = store.get(accessTokenAtom);

  // if no access token, redirect to spotify to authenticate
  if (!accessToken) {
    authorizeSpotify();
  }

  // ensure we're onboarded
  try {
    const data = await queryClient.fetchQuery({
      queryKey: ["user", "me"],
      queryFn: () => parseResponse(apiClient.user.me.$get()),
    });

    // if not onboarded, make the user onboard
    if (!data.onboarded) {
      throw redirect("/onboard");
    }
  } catch (err) {
    // this is what the throw redirect(..) throws. we don't actually want to watch that, so we throw it back
    if (err instanceof Response) {
      throw err;
    }

    console.error(err);

    // if there's an error or no user data, redirect to spotify to re-auth
    authorizeSpotify();
  }
}

export default function AppLayout() {
  return <Outlet />;
}
