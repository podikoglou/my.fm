import { getDefaultStore } from "jotai";
import { Outlet, redirect } from "react-router";
import { makeSpotifyAuthorizeUrl } from "~/lib/spotify";
import { accessTokenAtom } from "~/state/auth";

export async function clientLoader() {
  const store = getDefaultStore();
  const accessToken = store.get(accessTokenAtom);

  // if no access token, redirect to spotify to authenticate
  if (!accessToken) {
    const url = makeSpotifyAuthorizeUrl();

    throw redirect(url.toString());
  }
}

export default function Layout() {
  return (
    <>
      <Outlet />
    </>
  );
}
