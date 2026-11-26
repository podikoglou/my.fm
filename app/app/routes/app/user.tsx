import { ProfilePrivateApiError } from "@my.fm/api";
import { useQuery } from "@tanstack/react-query";
import { Schema } from "effect";
import { Lock, UserX } from "lucide-react";
import { Navigate } from "react-router";

import { ErrorCard } from "~/components/error-card";
import { CardHeader, CardContent } from "~/components/ui/card";
import { UserAvatar } from "~/components/user-avatar";
import { UserTrackList } from "~/components/user-track-list";
import { useViewer } from "~/hooks/use-current-user";
import { apiClient, runApi } from "~/lib/api";

import type { Route } from "./+types/user";

const isProfilePrivateError = Schema.is(ProfilePrivateApiError);

export async function clientLoader({ params }: Route.LoaderArgs) {
  return params;
}

export default function AppUserPage({ loaderData: { username } }: Route.ComponentProps) {
  const { user: me } = useViewer();

  const { data, error } = useQuery({
    queryKey: ["user", "profile", username],
    queryFn: () => runApi(apiClient.user.byUsername({ query: { username } })),
    retry: false,
  });

  // The guarded layout skips this route, so the onboarding check lives here.
  if (me && !me.onboarded) {
    return <Navigate to="/onboard" replace />;
  }

  if (error) {
    if (isProfilePrivateError(error)) {
      return (
        <ErrorCard
          Icon={Lock}
          title={<>Private Profile</>}
          description={<>This user&apos;s profile is private</>}
        />
      );
    }

    return (
      <ErrorCard
        Icon={UserX}
        title={<>User Not Found</>}
        description={<>The user you&apos;re looking for does not exist</>}
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
