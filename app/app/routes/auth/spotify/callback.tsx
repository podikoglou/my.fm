import type { Route } from "./+types/callback";
import { redirect } from "react-router";

export async function clientLoader({ request }: Route.ClientLoaderArgs) {
  const searchParams = new URL(request.url).searchParams;
  const callbackURL = searchParams.get("callbackURL") || "/app";

  if (!callbackURL.startsWith("/") || callbackURL.startsWith("//")) {
    throw redirect("/app");
  }

  throw redirect(callbackURL);
}
