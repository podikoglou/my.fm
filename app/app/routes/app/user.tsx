import { useQuery } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { UserX } from "lucide-react";

import { ErrorCard } from "~/components/error-card";
import { Avatar, AvatarFallback, AvatarImage } from "~/components/ui/avatar";
import { CardHeader, CardContent } from "~/components/ui/card";
import { UserTrackList } from "~/components/user-track-list";
import { apiClient } from "~/lib/api";

import type { Route } from "./+types/user";

export async function clientLoader({ params }: Route.LoaderArgs) {
  return params;
}

function initials(name: string): string {
  const split = name.split(" ");

  if (split.length > 1) {
    // TODO: maybe clamp this to 2-3 elements
    return split
      .map((s) => s[0])
      .join("")
      .toUpperCase();
  }

  // assumption: name.length >= 1 (based on validation schema)
  return (name[0] + (name[1] || "")).toUpperCase();
}

function UserAvatar({ avatarUrl, name }: { avatarUrl: string | null; name: string }) {
  return (
    <Avatar className="h-24 w-24">
      {avatarUrl && <AvatarImage src={avatarUrl} alt="User" />}

      <AvatarFallback className="text-3xl">{initials(name)}</AvatarFallback>
    </Avatar>
  );
}

export default function AppUserPage({ loaderData: { username } }: Route.ComponentProps) {
  const { data, error } = useQuery({
    queryKey: ["user", username],
    queryFn: () => parseResponse(apiClient.user.byUsername.$get({ query: { username } })),
    retry: false,
  });

  if (error) {
    return (
      <ErrorCard
        icon={<UserX />}
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
