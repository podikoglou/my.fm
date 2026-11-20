import type { ReactNode } from "react";

export function SettingsRow({
  label,
  description,
  control,
}: {
  label: ReactNode;
  description?: ReactNode;
  control?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-4 p-4">
      <div className="min-w-0 flex-1 space-y-1">
        <div className="text-sm font-medium">{label}</div>
        {description && (
          <div className="space-y-2 text-sm text-muted-foreground">{description}</div>
        )}
      </div>
      {control && <div className="shrink-0">{control}</div>}
    </div>
  );
}
