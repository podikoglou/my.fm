import { ListMusic } from "lucide-react";

import { ErrorCard } from "./error-card";

export function ScrobblesError() {
  return (
    <ErrorCard
      Icon={ListMusic}
      title={<>Couldn't Find Scrobbles</>}
      description={<>We're not sure why</>}
    />
  );
}
