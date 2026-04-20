import { authClient } from "./auth";
import { apiClient } from "./api";
import { parseResponse } from "hono/client";
import { queryClient } from "./query";

export async function requireAuth(callbackURL: string) {
  const session = await authClient.getSession();

  if (!session.data) {
    await authClient.signIn.social({
      provider: "spotify",
      callbackURL,
      errorCallbackURL: "/auth/spotify/callback",
    });
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
    await authClient.signIn.social({
      provider: "spotify",
      callbackURL,
      errorCallbackURL: "/auth/spotify/callback",
    });
    return { session: null, user: null };
  }
}
