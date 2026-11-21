import { Check, Copy } from "lucide-react";
import { useState } from "react";

import { Button } from "~/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "~/components/ui/dialog";
import { agentOnboardingInstructions } from "~/lib/agents-instructions";

import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

export function AgentsSettings() {
  return (
    <SettingsSection title="Agents">
      <Dialog>
        <SettingsRow
          label={
            <DialogTrigger
              render={<Button variant="link" className="h-auto p-0 underline-offset-4" />}
            >
              Connect an agent
            </DialogTrigger>
          }
          description="Add the my.fm MCP server to Claude, OpenCode or another client. Access is read-only."
        />
        <DialogContent>
          <div className="space-y-1">
            <DialogTitle>Connect an agent</DialogTitle>
            <DialogDescription>
              Paste this into your agent. The first request opens a browser window where you allow
              access.
            </DialogDescription>
          </div>
          <Instructions />
        </DialogContent>
      </Dialog>
    </SettingsSection>
  );
}

/** Rendered inside the dialog portal, which mounts in the browser only. */
function Instructions() {
  const [status, setStatus] = useState<"idle" | "copied" | "failed">("idle");
  const text = agentOnboardingInstructions(window.location.origin);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setStatus("copied");
    } catch {
      setStatus("failed");
    }
  }

  return (
    <div className="space-y-2">
      <pre className="max-h-64 overflow-auto rounded-md border bg-muted p-3 text-xs break-words whitespace-pre-wrap">
        {text}
      </pre>

      <div className="flex items-center justify-between gap-3">
        <div role="status" className="text-xs text-muted-foreground">
          {status === "copied" && "Copied to clipboard."}
          {status === "failed" && (
            <span className="text-destructive">Copy failed. Select the text instead.</span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" size="sm" onClick={copy}>
            {status === "copied" ? <Check /> : <Copy />}
            {status === "copied" ? "Copied" : "Copy"}
          </Button>
          <DialogClose render={<Button size="sm" />}>Done</DialogClose>
        </div>
      </div>
    </div>
  );
}
