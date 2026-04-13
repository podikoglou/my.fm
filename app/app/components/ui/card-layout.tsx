import type { ReactNode } from "react";
import { Card } from "./card";

export function CardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="container mx-auto min-h-screen flex items-center justify-center max-w-md">
      <Card className="w-full max-w-lg h-168 overflow-hidden">{children}</Card>
    </div>
  );
}
