import { atom } from "jotai";
import { userMe } from "~/lib/api";

export const userAtom = atom(async () => await userMe());
