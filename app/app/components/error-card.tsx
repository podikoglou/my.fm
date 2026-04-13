import React from "react";
import { CardDescription, CardHeader, CardTitle } from "./ui/card";
import type { ReactElement, ReactNode } from "react";

export function ErrorCard({
  title,
  description,
  icon,
}: {
  title: ReactNode;
  description: ReactNode;
  icon: ReactNode;
}) {
  return (
    <CardHeader className="flex flex-col items-center justify-center gap-4 flex-1 text-center">
      {React.cloneElement(icon as ReactElement<{ className: string }>, {
        className: "h-16 w-16 text-muted-foreground opacity-50",
      })}

      <div>
        <CardTitle className="text-3xl font-bold">{title}</CardTitle>
        <CardDescription className="mt-2">{description}</CardDescription>
      </div>
    </CardHeader>
  );
}
