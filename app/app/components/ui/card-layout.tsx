import type { ReactNode } from "react";

import { Card } from "./card";

export function CardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container mx-auto flex min-h-screen max-w-md items-center justify-center">
      <Card className="h-168 w-full max-w-lg overflow-hidden">{children}</Card>
    </div>
  );
}
