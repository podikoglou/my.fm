import { useMutation } from "@tanstack/react-query";
import { redirect, useLoaderData } from "react-router";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { CardLayout } from "~/components/ui/card-layout";
import { apiClient, runApi } from "~/lib/api";
import { requireAuth } from "~/lib/auth-guard";
import { onboardingPath } from "~/lib/auth-return";

export function meta() {
  return [{ title: "Connect an app · my.fm" }];
}

export async function clientLoader({ request }: { request: Request }) {
  const url = new URL(request.url);
  const returnTo = url.pathname + url.search;
  const { user } = await requireAuth(returnTo);

  if (!user) return { consent: null, query: url.search, error: null };

  if (!user.onboarded) throw redirect(onboardingPath(returnTo));

  try {
    const consent = await runApi(
      apiClient.oauth.getAuthorize({ query: Object.fromEntries(url.searchParams) }),
    );

    return { consent, query: url.search, error: null };
  } catch {
    return {
      consent: null,
      query: url.search,
      error:
        "This authorization request is invalid or has expired. Start again from the connecting app.",
    };
  }
}

export default function OAuthAuthorizePage() {
  const { consent, query, error } = useLoaderData<typeof clientLoader>();

  const decision = useMutation({
    mutationFn: (value: "allow" | "deny") =>
      runApi(apiClient.oauth.decideAuthorize({ payload: { decision: value, query } })),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  return (
    <CardLayout cardClassName="sm:h-auto sm:max-w-sm">
      <CardHeader>
        <CardTitle className="text-3xl font-bold">Connect an app</CardTitle>
        <CardDescription className="mt-2">
          {consent
            ? `${consent.client.clientName || "This app"} wants read-only access to your my.fm account.`
            : error
              ? "Unable to connect this app."
              : "Checking your account…"}
        </CardDescription>
      </CardHeader>

      <CardContent className="flex flex-col gap-5">
        {consent ? (
          <>
            <dl className="divide-y rounded-lg border">
              {consent.client.clientUri ? (
                <Detail label="Website" value={consent.client.clientUri} />
              ) : null}
              <Detail label="Redirects to" value={new URL(consent.redirectUri).origin} />
              {URL.canParse(consent.client.clientId) ? (
                <Detail label="Client ID" value={consent.client.clientId} />
              ) : null}
            </dl>

            <div className="space-y-1">
              <p className="text-xs font-medium text-muted-foreground">Access</p>
              <p className="text-sm">
                Read your profile, listening history and the public feed. No changes.
              </p>
            </div>
          </>
        ) : null}

        {error || decision.isError ? (
          <Alert variant="danger">
            <AlertDescription>
              {error ||
                "Your decision could not be saved. Try again, or restart from the connecting app."}
            </AlertDescription>
          </Alert>
        ) : null}

        {consent ? (
          <div className="flex gap-3">
            <Button
              className="flex-1"
              variant="outline"
              disabled={decision.isPending}
              onClick={() => decision.mutate("deny")}
            >
              Deny
            </Button>
            <Button
              className="flex-1"
              disabled={decision.isPending}
              onClick={() => decision.mutate("allow")}
            >
              Allow
            </Button>
          </div>
        ) : null}
      </CardContent>
    </CardLayout>
  );
}

/** A value the user can read but does not choose, so it carries no emphasis. */
function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="space-y-1 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="font-mono text-xs break-all">{value}</dd>
    </div>
  );
}
