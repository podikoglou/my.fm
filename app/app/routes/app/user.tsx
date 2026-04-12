import { useQuery } from "@tanstack/react-query";
import { apiClient } from "~/lib/api";
import { parseResponse } from "hono/client";
import type { Route } from "./+types/user";

export async function clientLoader({ params }: Route.LoaderArgs) {
  return params;
}

export default function AppUserPage({ loaderData: { username } }: Route.ComponentProps) {
  const { data, error } = useQuery({
    queryKey: ["user", username],
    queryFn: () => parseResponse(apiClient.user.byUsername.$get({ query: { username } })),
    retry: false,
  });

  return <>{JSON.stringify({ data, error })}</>;
}
