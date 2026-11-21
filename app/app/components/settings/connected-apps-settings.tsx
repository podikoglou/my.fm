import { useConnectedApps } from "~/hooks/use-connected-apps";
import { useRevokeApp } from "~/hooks/use-revoke-app";

import { ConnectAgentDialog } from "./connect-agent-dialog";
import { ConnectedAppRow } from "./connected-app-row";
import { SettingsSection } from "./settings-section";

export function ConnectedAppsSettings() {
  const { data } = useConnectedApps();
  const revoke = useRevokeApp();
  const apps = data?.apps;

  return (
    <SettingsSection title="Connected apps">
      <ConnectAgentDialog />

      {apps?.map((app) => (
        <ConnectedAppRow
          key={app.id}
          app={app}
          isRevoking={revoke.isPending && revoke.variables === app.id}
          isError={revoke.isError && revoke.variables === app.id}
          onRevoke={() => revoke.mutate(app.id)}
        />
      ))}
    </SettingsSection>
  );
}
