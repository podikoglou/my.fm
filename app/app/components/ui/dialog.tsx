import type * as React from "react";

import { Dialog as BaseDialog } from "@base-ui/react/dialog";

import { cn } from "~/lib/utils";

const Dialog = BaseDialog.Root;
const DialogTrigger = BaseDialog.Trigger;
const DialogClose = BaseDialog.Close;

/**
 * The viewport ignores pointer events so a press outside the popup reaches the
 * backdrop, which is the element Base UI closes the dialog on.
 */
function DialogContent({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseDialog.Popup>) {
  return (
    <BaseDialog.Portal>
      <BaseDialog.Backdrop
        data-slot="dialog-backdrop"
        className="fixed inset-0 z-50 bg-black/50 transition-opacity duration-150 data-closed:opacity-0 data-open:opacity-100"
      />
      <BaseDialog.Viewport className="pointer-events-none fixed inset-0 z-50 flex items-center justify-center p-4">
        <BaseDialog.Popup
          data-slot="dialog-content"
          className={cn(
            "pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-full max-w-sm flex-col gap-4 overflow-y-auto rounded-xl border bg-card p-6 text-card-foreground shadow-lg transition-[opacity,scale] duration-150 data-closed:scale-95 data-closed:opacity-0",
            className,
          )}
          {...props}
        >
          {children}
        </BaseDialog.Popup>
      </BaseDialog.Viewport>
    </BaseDialog.Portal>
  );
}

function DialogTitle({ className, ...props }: React.ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      data-slot="dialog-title"
      className={cn("text-lg font-semibold", className)}
      {...props}
    />
  );
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      data-slot="dialog-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  );
}

export { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, DialogTrigger };
