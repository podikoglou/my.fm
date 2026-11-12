import type * as React from "react";

import { Switch as BaseSwitch } from "@base-ui/react/switch";

import { cn } from "~/lib/utils";

function Switch({ className, ...props }: React.ComponentProps<typeof BaseSwitch.Root>) {
  return (
    <BaseSwitch.Root
      data-slot="switch"
      className={cn(
        "inline-flex h-5 w-8 shrink-0 items-center rounded-full border shadow-xs transition-all duration-200 outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50 data-checked:border-primary data-checked:bg-primary data-disabled:pointer-events-none data-disabled:opacity-50 data-unchecked:bg-input data-unchecked:hover:border-ring/70",
        className,
      )}
      {...props}
    >
      <BaseSwitch.Thumb
        data-slot="switch-thumb"
        className={cn(
          "pointer-events-none block size-4 rounded-full bg-foreground ring-0 transition-transform duration-200 ease-in-out data-checked:translate-x-[calc(100%-3px)] data-checked:bg-background data-unchecked:translate-x-px",
        )}
      />
    </BaseSwitch.Root>
  );
}

export { Switch };
