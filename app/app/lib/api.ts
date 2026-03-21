import { useAtom } from "jotai/react";
import ky from "ky";
import { accessTokenAtom } from "~/state/auth";

export const makeClient = (authToken: string | null) =>
  ky.create({
    prefixUrl: "https://api.my.fm/",
    headers: authToken
      ? {
          Authorization: authToken,
        }
      : {},
  });

export const useAuthenticatedClient = () => {
  const [accessToken, _] = useAtom(accessTokenAtom);

  return makeClient(accessToken);
};
