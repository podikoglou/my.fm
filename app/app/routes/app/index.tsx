import { useQuery } from "@tanstack/react-query";
import { usersMeOptions } from "~/lib/api/@tanstack/react-query.gen";

export default function AppIndex() {
  const { data, error } = useQuery({
    ...usersMeOptions({}),
  });

  console.log({ data, error });

  return <>{JSON.stringify({ data, error })}</>;
}
