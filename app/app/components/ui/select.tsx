import type * as React from "react";

import { Select as BaseSelect } from "@base-ui/react/select";
import { CheckIcon, ChevronDownIcon } from "lucide-react";

import { cn } from "~/lib/utils";

const Select = BaseSelect.Root;
const SelectValue = BaseSelect.Value;

function SelectTrigger({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Trigger>) {
  return (
    <BaseSelect.Trigger
      data-slot="select-trigger"
      className={cn(
        "group flex h-9 items-center justify-between gap-2 rounded-md border bg-input px-3 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow,border-color] outline-none select-none hover:border-ring/70 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50",
        className,
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <ChevronDownIcon className="size-4 text-muted-foreground transition-transform group-data-popup-open:rotate-180" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  );
}

function SelectContent({ children, ...props }: React.ComponentProps<typeof BaseSelect.Popup>) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner sideOffset={4} alignItemWithTrigger={false}>
        <BaseSelect.Popup
          data-slot="select-content"
          className="relative z-50 max-h-(--available-height) min-w-(--anchor-width) overflow-x-hidden overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
          {...props}
        >
          <BaseSelect.List>{children}</BaseSelect.List>
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  );
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      data-slot="select-item"
      className={cn(
        "relative flex cursor-default items-center rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-highlighted:bg-accent data-highlighted:text-accent-foreground",
        className,
      )}
      {...props}
    >
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
      <BaseSelect.ItemIndicator className="absolute right-2">
        <CheckIcon className="size-4 text-muted-foreground" />
      </BaseSelect.ItemIndicator>
    </BaseSelect.Item>
  );
}

export { Select, SelectContent, SelectItem, SelectTrigger, SelectValue };
