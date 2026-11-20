import { useState } from "react";

import { getTheme, setTheme, type Theme } from "~/lib/theme";

export function useTheme() {
  const [theme, setSelectedTheme] = useState(getTheme);

  function selectTheme(nextTheme: Theme | null) {
    if (nextTheme === null) return;
    setTheme(nextTheme);
    setSelectedTheme(nextTheme);
  }

  return { theme, selectTheme };
}
