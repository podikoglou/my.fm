import ky, { type KyInstance } from "ky";

type ApiClient = KyInstance;

export type User = Awaited<ReturnType<typeof callUserMe>>;
export type ApiError = { error: string };

export const makeClient = (authToken: string | null) =>
  ky.create({
    prefixUrl: "https://api.my.fm/",
    headers: authToken
      ? {
          Authorization: `Bearer ${authToken}`,
        }
      : {},
  });

export const callUserMe = (client: ApiClient) => {
  return client
    .get("user/me")
    .json<{ id: string; email: string; name: string; username: string; onboarded: boolean }>();
};

export const callUserOnboard = (client: ApiClient, data: { name: string; username: string }) => {
  return client.post("user/onboard", { json: data }).json<{} | ApiError>();
};
