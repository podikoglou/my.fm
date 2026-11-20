import { ListMusic } from "lucide-react";

import { ErrorCard } from "./error-card";

export function ScrobblesError() {
  return (
    <ErrorCard
      Icon={ListMusic}
      title={<>Couldn&apos;t Find Scrobbles</>}
      description={<>We&apos;re not sure why</>}
    />
  );
}
