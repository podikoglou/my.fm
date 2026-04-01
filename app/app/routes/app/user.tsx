import { useQuery } from "@tanstack/react-query";
import { getUsersOptions } from "~/lib/api/@tanstack/react-query.gen";
import type { Route } from "./+types/user";

export async function clientLoader({ params }: Route.LoaderArgs) {
  return params;
}

export default function AppUserPage({ loaderData: { username } }: Route.ComponentProps) {
  const { data, error } = useQuery({
    ...getUsersOptions({ path: { username } }),
  });

  return <>{JSON.stringify({ data, error })}</>;
}
