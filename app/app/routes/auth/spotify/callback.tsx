import { getDefaultStore } from "jotai";
import { accessTokenAtom } from "~/state/auth";
import type { Route } from "./+types/callback";
import { redirect } from "react-router";
import { authSpotify } from "~/lib/api";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // parse code from spotify redirect
  const searchParams = new URL(request.url).searchParams;
  const authorizationCode = searchParams.get("code");

  if (!authorizationCode) {
    return; // TODO: handle error
  }

  // send authorization code to our backend, expecting back a JWT
  // this doesn't go through react query which is meh
  const { data, error } = await authSpotify({ body: { code: authorizationCode } });

  if (error) {
    return; // TODO: handle error
  }

  const store = getDefaultStore();
  store.set(accessTokenAtom, data.accessToken);

  throw redirect("/app");
}
