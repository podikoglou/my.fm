import { useMutation } from "@tanstack/react-query";
import { parseResponse } from "hono/client";
import { redirect, useLoaderData } from "react-router";

import { Alert, AlertDescription } from "~/components/ui/alert";
import { Button } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { apiClient } from "~/lib/api";
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
    const consent = await parseResponse(
      apiClient.oauth.authorize.$get({ query: Object.fromEntries(url.searchParams) }),
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
      parseResponse(apiClient.oauth.authorize.$post({ json: { decision: value, query } })),
    onSuccess: ({ redirectTo }) => window.location.assign(redirectTo),
  });

  return (
    <div className="flex w-full flex-col gap-6 sm:w-96">
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

      <CardContent className="flex flex-col gap-4">
        {consent ? (
          <>
            {consent.client.clientUri ? (
              <p className="text-sm break-words text-muted-foreground">
                {consent.client.clientUri}
              </p>
            ) : null}
            <p className="text-sm break-words text-muted-foreground">
              Redirects to {new URL(consent.redirectUri).origin}
            </p>
            {URL.canParse(consent.client.clientId) ? (
              <p className="text-sm break-words text-muted-foreground">
                Client ID: {consent.client.clientId}
              </p>
            ) : null}
            <p className="text-sm">
              Read your profile, listening history and the public feed; no changes.
            </p>
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
    </div>
  );
}
