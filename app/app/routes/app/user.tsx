import { useQuery } from "@tanstack/react-query";
import { DetailedError, parseResponse } from "hono/client";
import { Lock, UserX } from "lucide-react";

import { ErrorCard } from "~/components/error-card";
import { CardHeader, CardContent } from "~/components/ui/card";
import { UserAvatar } from "~/components/user-avatar";
import { UserTrackList } from "~/components/user-track-list";
import { apiClient } from "~/lib/api";

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

  if (error) {
    if (error instanceof DetailedError && error.statusCode === 403) {
      return (
        <ErrorCard
          Icon={Lock}
          title={<>Private Profile</>}
          description={<>This user's profile is private</>}
        />
      );
    }

    return (
      <ErrorCard
        Icon={UserX}
        title={<>User Not Found</>}
        description={<>The user you're looking for does not exist</>}
      />
    );
  }

  if (!data) return <></>;

  return (
    <>
      <CardHeader className="flex flex-col items-center gap-4">
        <UserAvatar avatarUrl={data.avatarUrl} name={data.name} />

        <div className="space-y-1 text-center">
          <h1 className="text-3xl font-bold">{data.name}</h1>
          <p className="text-sm text-muted-foreground">@{data.username}</p>
        </div>
      </CardHeader>

      <CardContent className="min-h-0 flex-1 overflow-hidden">
        <UserTrackList username={username} />
      </CardContent>
    </>
  );
}
