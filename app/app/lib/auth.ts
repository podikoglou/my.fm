import { createAuthClient } from "better-auth/react";

import { apiUrl } from "./api-url";

export const authClient = createAuthClient({
  baseURL: apiUrl,
  fetchOptions: {
    credentials: "include",
  },
});

export type Session = typeof authClient.$Infer.Session;
