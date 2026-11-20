import { CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { acknowledgeAndSignOut } from "~/lib/notifications";

import type { Route } from "./+types/notification";

export function meta() {
  return [{ title: "Signing out · my.fm" }];
}

export async function clientLoader({ params }: Route.ClientLoaderArgs) {
  await acknowledgeAndSignOut(params.id);
}

export default function NotificationPage() {
  return (
    <CardHeader className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <div>
        <CardTitle className="text-3xl font-bold">Signing you out</CardTitle>
        <CardDescription className="mt-2">Taking you to sign in with Spotify.</CardDescription>
      </div>
    </CardHeader>
  );
}
