import { createAuthClient } from "better-auth/react";

/**
 * Better Auth defaults to the current origin and `/api/auth` when no base URL
 * is given. The app Worker proxies that path to the API Worker, so the session
 * cookie stays first-party.
 */
export const authClient = createAuthClient({
  fetchOptions: {
    credentials: "include",
  },
});

export type Session = typeof authClient.$Infer.Session;
