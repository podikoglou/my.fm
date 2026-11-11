import type { ComponentType, ReactNode } from "react";

import { CardDescription, CardHeader, CardTitle } from "./ui/card";

export function ErrorCard({
  title,
  description,
  Icon,
}: {
  title: ReactNode;
  description: ReactNode;
  Icon: ComponentType<{ className?: string }>;
}) {
  return (
    <CardHeader className="flex flex-1 flex-col items-center justify-center gap-4 text-center">
      <Icon className="h-16 w-16 text-muted-foreground opacity-50" />

      <div>
        <CardTitle className="text-3xl font-bold">{title}</CardTitle>
        <CardDescription className="mt-2">{description}</CardDescription>
      </div>
    </CardHeader>
  );
}
