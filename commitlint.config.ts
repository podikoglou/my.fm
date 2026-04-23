import type { UserConfig } from "@commitlint/types";

const Configuration: UserConfig = {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "type-enum": [2, "always", ["feat", "fix", "refactor", "build", "style", "docs", "chore"]],
    "scope-enum": [2, "always", ["api", "app"]],
  },
};

export default Configuration;
