import { getDefaultStore } from "jotai";
import { Outlet, redirect } from "react-router";
import { makeSpotifyAuthorizeUrl } from "~/lib/spotify";
import { accessTokenAtom } from "~/state/auth";
import { userAtom } from "~/state/user";

export async function clientLoader() {
  const store = getDefaultStore();

  // ensure we've got an access token
  const accessToken = store.get(accessTokenAtom);

  // if no access token, redirect to spotify to authenticate
  if (!accessToken) {
    const url = makeSpotifyAuthorizeUrl();

    throw redirect(url.toString());
  }

  // ensure we're onboarded
  const user = await store.get(userAtom);

  if (user.error || !user.data) {
    // if there's an error or no user data, redirect to spotify to re-auth
    const url = makeSpotifyAuthorizeUrl();
    throw redirect(url.toString());
  }

  if (!user.data.onboarded) {
    throw redirect("/onboard");
  }
}

export default function Layout() {
  return (
    <>
      <Outlet />
    </>
  );
}
