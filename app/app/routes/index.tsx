import { replace } from "react-router";

import { readAuth } from "~/lib/auth-guard";

export async function clientLoader() {
  const { user } = await readAuth();

  if (!user) return replace("/feed");

  if (!user.onboarded) return replace("/onboard");

  return replace(`/user/${encodeURIComponent(user.username)}`);
}
