import { apiClient, runApi } from "./api";
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

export async function readAuth() {
  try {
    const session = await authClient.getSession();

    if (!session.data) return { session: null, user: null };

    const data = await queryClient.fetchQuery({
      queryKey: ["user", "me"],
      queryFn: () => runApi(apiClient.user.me()),
      staleTime: 0,
    });

    return { session: session.data, user: data };
  } catch (error) {
    console.error(error);

    return { session: null, user: null };
  }
}

export async function requireAuth(callbackURL: string) {
  const auth = await readAuth();

  if (!auth.user) await signInWithSpotify(callbackURL);

  return auth;
}
