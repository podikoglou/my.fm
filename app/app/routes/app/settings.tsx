import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";

import { AppearanceSettings } from "~/components/settings/appearance-settings";
import { SettingsRow } from "~/components/settings/settings-row";
import { SettingsSection } from "~/components/settings/settings-section";
import { Button, buttonVariants } from "~/components/ui/button";
import { CardContent, CardDescription, CardHeader, CardTitle } from "~/components/ui/card";
import { Label } from "~/components/ui/label";
import { Switch } from "~/components/ui/switch";
import { UserAvatar } from "~/components/user-avatar";
import { useCurrentUser } from "~/hooks/use-current-user";
import { useImportUpload } from "~/hooks/use-import-upload";
import { useLatestImport } from "~/hooks/use-latest-import";
import { usePrivacySetting } from "~/hooks/use-privacy-setting";
import { useSignOut } from "~/hooks/use-sign-out";
import { importErrorMessage } from "~/lib/import-error-message";

export default function SettingsPage() {
  const { data } = useCurrentUser();
  const privacy = usePrivacySetting();
  const { inputRef, uploadImport, handleFileChange, openFilePicker } = useImportUpload();
  const { data: latestImportData } = useLatestImport();
  const signOut = useSignOut();
  const latestImport = latestImportData?.import;

  if (!data) return <></>;

  return (
    <>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="text-3xl font-bold">Settings</CardTitle>
            <CardDescription className="mt-2">Manage your profile and account.</CardDescription>
          </div>

          <Link
            to={`/user/${data.username}`}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft />
            Back
          </Link>
        </div>
      </CardHeader>

      <CardContent className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
        <SettingsSection title="Account">
          <SettingsRow
            className="max-[360px]:flex-col max-[360px]:items-stretch"
            label={
              <div className="flex items-center gap-3">
                <UserAvatar
                  avatarUrl={data.avatarUrl}
                  name={data.name}
                  className="h-10 w-10"
                  fallbackClassName="text-sm"
                />
                <div className="min-w-0 space-y-1">
                  <p className="font-semibold wrap-anywhere">{data.name}</p>
                  <p className="truncate text-sm font-normal text-muted-foreground">
                    @{data.username}
                  </p>
                  <p className="text-sm font-normal wrap-anywhere text-muted-foreground">
                    {data.email}
                  </p>
                  <div role="status" className="text-sm font-normal text-destructive">
                    {signOut.isError && <p>Could not sign out. Try again.</p>}
                  </div>
                </div>
              </div>
            }
            control={
              <Button
                variant="outline"
                disabled={signOut.isPending}
                focusableWhenDisabled
                onClick={() => signOut.mutate()}
              >
                {signOut.isPending ? "Signing out..." : "Sign out"}
              </Button>
            }
          />
        </SettingsSection>

        <SettingsSection title="Privacy">
          <SettingsRow
            label={<Label htmlFor="isPrivate">Private profile</Label>}
            description={
              <>
                <p id="isPrivate-description">
                  Only you can see your profile and your listening history.
                </p>
                <div role="status" className="text-destructive">
                  {privacy.isError && <p>Could not save your settings. Please try again.</p>}
                </div>
              </>
            }
            control={
              <Switch
                id="isPrivate"
                checked={privacy.isPending ? privacy.variables : data.isPrivate}
                onCheckedChange={(checked) => privacy.mutate(checked)}
                aria-describedby="isPrivate-description"
                disabled={privacy.isPending}
              />
            }
          />
        </SettingsSection>

        <AppearanceSettings />

        <SettingsSection title="Data">
          <SettingsRow
            label="Import listening history"
            description={
              <>
                <p>Upload a listening history CSV export (up to 10 MB).</p>
                <div role="status" className="space-y-2">
                  {latestImport && (
                    <p className="text-xs">
                      Status: {latestImport.status}
                      {latestImport.processedRows > 0 &&
                        ` (${latestImport.processedRows} plays processed)`}
                    </p>
                  )}
                  {latestImport?.status === "failed" && (
                    <p className="text-destructive">
                      {latestImport.error ?? "Import failed. Please try again."}
                    </p>
                  )}
                  {uploadImport.isSuccess && (
                    <p>File accepted. Ingestion will process in the background.</p>
                  )}
                  {uploadImport.error && (
                    <p className="text-destructive">{importErrorMessage(uploadImport.error)}</p>
                  )}
                </div>
              </>
            }
            control={
              <>
                <input
                  ref={inputRef}
                  type="file"
                  accept=".csv"
                  aria-label="Listening history CSV"
                  className="hidden"
                  onChange={handleFileChange}
                  disabled={uploadImport.isPending}
                />
                <Button
                  variant="outline"
                  onClick={openFilePicker}
                  disabled={uploadImport.isPending}
                >
                  {uploadImport.isPending ? "Uploading..." : "Import"}
                </Button>
              </>
            }
          />
        </SettingsSection>
      </CardContent>
    </>
  );
}
