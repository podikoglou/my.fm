import { formatDistanceToNow } from "date-fns";

import type { ConnectedApp } from "~/hooks/use-connected-apps";

import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";

import { SettingsRow } from "./settings-row";

export function ConnectedAppRow({
  app,
  isRevoking,
  isError,
  onRevoke,
}: {
  app: ConnectedApp;
  isRevoking: boolean;
  isError: boolean;
  onRevoke: () => void;
}) {
  return (
    <SettingsRow
      label={
        <div className="flex items-center gap-2">
          {app.clientUri ? (
            <a
              href={app.clientUri}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:underline"
            >
              {app.name}
            </a>
          ) : (
            <span>{app.name}</span>
          )}
          <Badge variant="outline" className="text-[10px] font-normal">
            Read-only
          </Badge>
        </div>
      }
      description={
        <>
          <p>
            Connected {formatDistanceToNow(new Date(app.createdAt * 1000), { addSuffix: true })}.
          </p>
          {isError && (
            <div role="status" className="text-destructive">
              Could not revoke access. Please try again.
            </div>
          )}
        </>
      }
      control={
        <Button
          variant="outline"
          size="sm"
          disabled={isRevoking}
          focusableWhenDisabled
          onClick={onRevoke}
        >
          {isRevoking ? "Revoking..." : "Revoke"}
        </Button>
      }
    />
  );
}
