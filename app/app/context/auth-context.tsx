import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { useApiClient } from "~/lib/api";
import type { MeUser } from "~/models/user";

export type AuthContextData = { user: MeUser | null; loading: boolean };

export const AuthContext = createContext<AuthContextData>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<MeUser | null>(null);
  const [loading, setLoading] = useState(true);
  const apiClient = useApiClient();

  useEffect(() => {
    apiClient
      .get("auth/me")
      .json<MeUser>()
      .then(setUser)
      .finally(() => setLoading(false));
  }, []);

  return <AuthContext.Provider value={{ user, loading }}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
