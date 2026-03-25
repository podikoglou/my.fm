import { getDefaultStore } from "jotai";
import { accessTokenAtom } from "~/state/auth";
import type { Route } from "./+types/callback";
import { makeClient } from "~/lib/api";
import { redirect } from "react-router";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  // parse code from spotify redirect
  const searchParams = new URL(request.url).searchParams;
  const authorizationCode = searchParams.get("code");

  if (!authorizationCode) {
    return; // TODO: handle error
  }

  // create one-use unauthenticated API client
  const client = makeClient(null);

  // send authorization code to our backend, expecting back a JWT
  // TODO: make this a thing in lib/api.ts
  const { accessToken } = await client
    .post("auth/spotify", {
      json: {
        code: authorizationCode,
      },
    })
    .json<{ accessToken: string }>();

  const store = getDefaultStore();
  store.set(accessTokenAtom, accessToken);

  throw redirect("/app");
}
