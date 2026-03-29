import { useQuery } from "@tanstack/react-query";
import { getUserOptions } from "~/lib/api/@tanstack/react-query.gen";

export default function AppIndexPage() {
  const { data, error } = useQuery({
    ...getUserOptions({}),
  });

  console.log({ data, error });

  return <>{JSON.stringify({ data, error })}</>;
}
