import cloudflare from "@cloudflare/oxlint-config";
import { recommended as effectRecommended } from "@effect/tsgo/oxlint-presets";
import { defineConfig } from "oxlint";

export default defineConfig({
  ...cloudflare,
  plugins: [...(cloudflare.plugins ?? []), ...(effectRecommended.plugins ?? [])],
  jsPlugins: [
    ...(cloudflare.jsPlugins ?? []),
    {
      name: "anti-slop",
      specifier: import.meta.resolve("@timmo001/oxlint-rules/upstream/anti-slop"),
    },
    {
      name: "anti-slop-effect",
      specifier: import.meta.resolve("@timmo001/oxlint-rules/upstream/effect"),
    },
  ],
  ignorePatterns: [
    ...(cloudflare.ignorePatterns ?? []),
    "**/.agent/**",
    "**/.agents/**",
    "**/.alchemy/**",
    "**/.claude/**",
    "**/.codex/**",
    "**/.continue/**",
    "**/.cursor/**",
    "**/.gemini/**",
    "**/.opencode/**",
    "**/.pi/**",
    "**/.roo/**",
    "**/.windsurf/**",
  ],
  rules: {
    ...cloudflare.rules,
    ...effectRecommended.rules,
    // The preset's quality plugin already provides the other Anti-Slop rules.
    "anti-slop/no-module-mocking": "error",
    "anti-slop/no-runtime-typeof": "error",
    "anti-slop/no-shape-in-symbol-names": "error",
    "anti-slop/no-unknown-parameters": "error",
    "anti-slop/require-readable-spacing": "error",
    "anti-slop/require-safety-comment-for-type-assertion": "error",
    // Preserve the repository's TypeScript syntax and concise guard clauses.
    "typescript/array-type": "off",
    "import/consistent-type-specifier-style": "off",
    curly: ["error", "multi-line"],
    "no-console": "off",
    "import/no-namespace": [
      "error",
      { ignore: ["react", "alchemy", "@alchemy.run/cloudflare", "effect/**", "**/schema.ts"] },
    ],
  },
  overrides: [
    ...(cloudflare.overrides ?? []),
    {
      files: [
        "alchemy.run.ts",
        "effect-api/**/*.{ts,js,mts,mjs,cts,cjs}",
        "worker-api/**/*.{ts,js,mts,mjs,cts,cjs}",
      ],
      rules: {
        "anti-slop-effect/no-manual-effect-error-tag": "error",
        "anti-slop-effect/no-manual-tag-comparison": "error",
        "anti-slop-effect/no-manual-tagged-construction": "error",
        "anti-slop-effect/no-service-constructor-imports": "error",
        "anti-slop-effect/prefer-effect-match": "error",
      },
    },
    {
      files: ["worker-api/**/*.{ts,js,mts,mjs,cts,cjs}"],
      rules: { "no-unused-expressions": "off" },
    },
    {
      files: ["app/app/**/*.tsx"],
      rules: {
        // React Hook Form supplies promise-returning submit handlers.
        "@typescript-eslint/no-misused-promises": [
          "error",
          { checksVoidReturn: { attributes: false } },
        ],
      },
    },
    {
      files: ["app/app/routes/**/*.{ts,tsx}"],
      rules: {
        // React Router handles redirects and status data thrown by route loaders.
        "typescript/only-throw-error": [
          "error",
          {
            allow: [
              "Response",
              { from: "package", name: "DataWithResponseInit", package: "react-router" },
            ],
          },
        ],
      },
    },
    {
      files: [
        "app/test/**/*.test.ts",
        "effect-api/test/**/*.test.ts",
        "worker-api/test/**/*.test.ts",
      ],
      rules: {
        // Test-local fixtures and stubs are easier to read next to their callers.
        "unicorn/consistent-function-scoping": "off",
      },
    },
    {
      files: ["app/test/worker.test.ts", "worker-api/src/routes/import.ts"],
      rules: { "@nkzw/no-instanceof": "off" }, // Narrow platform Request and File values.
    },
    {
      files: [
        "worker-api/src/import/graphql.ts",
        "worker-api/src/import/normalize.ts",
        "worker-api/test/d1.ts",
        "worker-api/test/ingestion.test.ts",
      ],
      rules: { "typescript/no-unsafe-type-assertion": "off" }, // Still requires a SAFETY comment.
    },
    {
      files: ["effect-api/test/env.d.ts", "worker-api/test/env.d.ts"],
      rules: {
        "typescript/consistent-type-imports": ["error", { disallowTypeAnnotations: false }],
      },
    },
  ],
});
