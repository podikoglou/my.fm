import { Outlet, redirect } from "react-router";

import { requireAuth } from "~/lib/auth-guard";

export async function clientLoader() {
  const { user } = await requireAuth("/app");

  if (user && !user.onboarded) {
    throw redirect("/onboard");
  }
}

export default function AppLayout() {
  return <Outlet />;
}
