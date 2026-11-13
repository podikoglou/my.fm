import { useState } from "react";
import { useSearchParams } from "react-router";

import { Button } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { describeAuthError } from "~/lib/auth-errors";
import { signInWithSpotify } from "~/lib/auth-guard";

/**
 * The description comes from a query parameter, so anyone can put text in it.
 * Cut it short, because a long value overflows the card.
 */
const MAX_DESCRIPTION_LENGTH = 200;

export function meta() {
  return [{ title: "Sign-in failed · my.fm" }];
}

export default function AuthErrorPage() {
  const [searchParams] = useSearchParams();
  const [pending, setPending] = useState(false);
  const error = searchParams.get("error");
  const errorDescription = searchParams.get("error_description") ?? "";
  const shortenedDescription = errorDescription.slice(0, MAX_DESCRIPTION_LENGTH);

  async function retry() {
    setPending(true);

    try {
      await signInWithSpotify("/");
    } catch (cause) {
      // The button must not stay disabled when the request never leaves.
      console.error(cause);
      setPending(false);
    }
  }

  return (
    <div className="flex w-96 flex-col gap-6">
      <CardHeader className="flex flex-1 flex-col gap-4">
        <div>
          <CardTitle className="text-3xl font-bold">Sign-in failed</CardTitle>
          <CardDescription className="mt-2">{describeAuthError(error)}</CardDescription>
        </div>
      </CardHeader>

      <CardContent className="flex flex-col gap-4">
        {shortenedDescription ? (
          <p className="text-sm break-words text-muted-foreground">
            {shortenedDescription}
            {shortenedDescription.length < errorDescription.length ? "…" : ""}
          </p>
        ) : null}

        <Button onClick={retry} disabled={pending}>
          Try again
        </Button>

        {error ? <p className="text-xs text-muted-foreground">Error code: {error}</p> : null}
      </CardContent>
    </div>
  );
}
