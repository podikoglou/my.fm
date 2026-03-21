import { useAtom } from "jotai/react";
import ky from "ky";
import { authTokenAtom } from "~/state/auth";

const makeClient = (authToken: string | null) =>
  ky.create({
    prefixUrl: "https://api.my.fm/",
    headers: authToken
      ? {
          Authorization: authToken,
        }
      : {},
  });

export const useApiClient = () => {
  const [authToken, _] = useAtom(authTokenAtom);

  return makeClient(authToken);
};
