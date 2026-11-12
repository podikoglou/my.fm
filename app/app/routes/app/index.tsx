import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { Navigate } from "react-router";

import { apiClient } from "~/lib/api";

export default function AppIndexPage() {
  const { data } = useQuery({
    queryKey: ["user", "me"],
    queryFn: () => parseResponse(apiClient.user.me.$get()),
  });

  if (!data) return <></>;

  return <Navigate to={`/app/user/${data.username}`} replace />;
}
