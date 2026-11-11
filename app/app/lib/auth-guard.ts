import { parseResponse } from "hono/client";

import { apiClient } from "./api";
import { authClient } from "./auth";
import { queryClient } from "./query";

async function signIn(callbackURL: string) {
  await authClient.signIn.social({
    provider: "spotify",
    callbackURL,
    errorCallbackURL: "/auth/spotify/callback",
  });
}

export async function requireAuth(callbackURL: string) {
  const session = await authClient.getSession();

  if (!session.data) {
    await signIn(callbackURL);

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
    await signIn(callbackURL);

    return { session: null, user: null };
  }
}
