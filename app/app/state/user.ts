import { atom } from "jotai";
import { callUserMe, clientAtom } from "~/lib/api";

export const userAtom = atom(async (get) => {
  const client = get(clientAtom);

  return await callUserMe(client);
});
