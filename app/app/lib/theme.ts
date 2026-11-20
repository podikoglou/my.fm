export const themeOptions = [
  { value: "system", label: "System" },
  { value: "light", label: "Light" },
  { value: "dark", label: "Dark" },
] as const;

export type Theme = (typeof themeOptions)[number]["value"];

const storageKey = "my.fm:theme";
const overrides = themeOptions.map(({ value }) => value).filter((value) => value !== "system");

export const themeBootstrapScript = `try {
  const theme = localStorage.getItem(${JSON.stringify(storageKey)});
  if (${JSON.stringify(overrides)}.includes(theme)) {
    document.documentElement.classList.add(theme);
  }
} catch {}`;

export function getTheme(): Theme {
  const { classList } = document.documentElement;
  return overrides.find((value) => classList.contains(value)) ?? "system";
}

export function setTheme(theme: Theme) {
  const { classList } = document.documentElement;
  for (const value of overrides) classList.toggle(value, value === theme);

  try {
    localStorage.setItem(storageKey, theme);
  } catch {
    // The choice still applies for this page when storage is blocked.
  }
}
