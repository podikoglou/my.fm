import { atom } from "jotai";
import ky, { type KyInstance } from "ky";
import { accessTokenAtom } from "~/state/auth";

type ApiClient = KyInstance;

export const makeClient = (authToken: string | null) =>
  ky.create({
    prefixUrl: "https://api.my.fm/",
    headers: authToken
      ? {
          Authorization: `Bearer ${authToken}`,
        }
      : {},
  });

export const clientAtom = atom((get) => {
  const accessToken = get(accessTokenAtom);

  return makeClient(accessToken);
});

export const callUserMe = (client: ApiClient) => {
  return client
    .get("user/me")
    .json<{ id: string; email: string; name: string; username: string; onboarded: boolean }>();
};

export type User = Awaited<ReturnType<typeof callUserMe>>;
