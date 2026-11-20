import type { ReactNode } from "react";

export function SettingsSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-2" aria-label={title}>
      <h2 className="px-1 text-xs font-medium text-muted-foreground">{title}</h2>
      <div className="divide-y rounded-lg border">{children}</div>
    </section>
  );
}
