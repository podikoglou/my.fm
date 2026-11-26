import { createAuthClient } from "better-auth/client";

export const authClient = createAuthClient({
  fetchOptions: { credentials: "include" },
});

export async function signInWithSpotify(callbackURL: string) {
  const result = await authClient.signIn.social({
    provider: "spotify",
    callbackURL,
    errorCallbackURL: "/auth/error",
  });

  if (result.error) throw new Error(result.error.message ?? "Spotify sign-in failed");
}
