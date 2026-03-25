import { atom } from "jotai";
import { callUserMe } from "~/lib/api";
import { clientAtom } from "./api";

export const userAtom = atom(async (get) => {
  const client = get(clientAtom);

  return await callUserMe(client);
});
