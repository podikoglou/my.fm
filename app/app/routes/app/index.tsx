import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { apiClient } from "~/lib/api";

export default function AppIndexPage() {
  const { data, error } = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => parseResponse(apiClient.user.me.$get()),
  });

  console.log({ data, error });

  return <>{JSON.stringify({ data, error })}</>;
}
