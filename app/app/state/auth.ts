import { atomWithStorage } from "jotai/utils";

export const accessTokenAtom = atomWithStorage<string | null>("access-token", null);

export const spotifyAuthorizationCodeAtom = atomWithStorage<string | null>(
  "spotify-authorization-code",
  null,
  undefined,
  { getOnInit: true },
);
