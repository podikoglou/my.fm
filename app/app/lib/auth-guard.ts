import { parseResponse } from "hono/client";

import { apiClient } from "./api";
import { authClient } from "./auth";
import { AUTH_ERROR_PATH } from "./auth-paths";
import { queryClient } from "./query";

export async function signInWithSpotify(callbackURL: string) {
  await authClient.signIn.social({
    provider: "spotify",
    callbackURL,
    errorCallbackURL: AUTH_ERROR_PATH,
  });
}

export async function requireAuth(callbackURL: string) {
  const session = await authClient.getSession();

  if (!session.data) {
    await signInWithSpotify(callbackURL);

    return { session: null, user: null };
  }

  try {
    const data = await queryClient.fetchQuery({
      queryKey: ["user", "me"],
      queryFn: () => parseResponse(apiClient.user.me.$get()),
    });

    return { session: session.data, user: data };
  } catch (err) {
    console.error(err);
    await signInWithSpotify(callbackURL);

    return { session: null, user: null };
  }
}
