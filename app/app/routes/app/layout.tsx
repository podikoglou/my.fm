import { getDefaultStore } from "jotai";
import { Outlet, redirect } from "react-router";
import { userMeOptions } from "~/lib/api/@tanstack/react-query.gen";
import { queryClient } from "~/lib/query";
import { authorizeSpotify } from "~/lib/spotify";
import { accessTokenAtom } from "~/state/auth";

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
      ...userMeOptions({}),
    });

    // if not onboarded, make the user onboard
    if (!data.onboarded) {
      throw redirect("/onboard");
    }
  } catch (err) {
    console.error(err);

    // if there's an error or no user data, redirect to spotify to re-auth
    // authorizeSpotify();
  }
}

export default function Layout() {
  return (
    <>
      <Outlet />
    </>
  );
}
