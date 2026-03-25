import { atom } from "jotai";
import { accessTokenAtom } from "./auth";
import { makeClient } from "~/lib/api";

export const clientAtom = atom((get) => {
  const accessToken = get(accessTokenAtom);

  return makeClient(accessToken);
});
