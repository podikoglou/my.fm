import { useQuery } from "@tanstack/react-query";
import { userMeOptions } from "~/lib/api/@tanstack/react-query.gen";

export default function AppIndex() {
  const { data, error } = useQuery({
    ...userMeOptions({}),
  });

  console.log({ data, error });

  return <>{JSON.stringify({ data, error })}</>;
}
