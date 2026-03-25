import { useAtom } from "jotai";
import { userAtom } from "~/state/user";

export default function AppIndex() {
  const [user, _] = useAtom(userAtom);

  return <>{JSON.stringify(user)}</>;
}
