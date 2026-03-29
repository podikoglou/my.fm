import { useQuery } from "@tanstack/react-query";
import { userOptions } from "~/lib/api/@tanstack/react-query.gen";

export default function AppIndex() {
  const { data, error } = useQuery({
    ...userOptions({}),
  });

  console.log({ data, error });

  return <>{JSON.stringify({ data, error })}</>;
}
