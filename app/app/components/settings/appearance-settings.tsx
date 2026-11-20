import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { useTheme } from "~/hooks/use-theme";
import { themeOptions } from "~/lib/theme";

import { SettingsRow } from "./settings-row";
import { SettingsSection } from "./settings-section";

export function AppearanceSettings() {
  const { theme, selectTheme } = useTheme();

  return (
    <SettingsSection title="Appearance">
      <SettingsRow
        label={<Label htmlFor="theme">Theme</Label>}
        control={
          <Select items={themeOptions} value={theme} onValueChange={selectTheme}>
            <SelectTrigger id="theme" className="min-w-26">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {themeOptions.map(({ value, label }) => (
                <SelectItem key={value} value={value}>
                  {label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        }
      />
    </SettingsSection>
  );
}
