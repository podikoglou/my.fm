import type { ReactNode } from "react";

import { Card } from "./card";

export function CardLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-dvh w-full items-center justify-center sm:container sm:mx-auto sm:min-h-screen sm:max-w-md">
      <Card className="h-dvh w-full overflow-x-hidden overflow-y-auto rounded-none border-0 pt-[max(1.5rem,env(safe-area-inset-top))] pr-[env(safe-area-inset-right)] pb-[max(1.5rem,env(safe-area-inset-bottom))] pl-[env(safe-area-inset-left)] shadow-none sm:h-168 sm:max-w-lg sm:overflow-hidden sm:rounded-xl sm:border sm:px-0 sm:py-6 sm:shadow-sm">
        {children}
      </Card>
    </div>
  );
}
