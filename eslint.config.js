// @ts-check
// Lints scripts/ only (demo orchestrator + seed + test-fixture helpers) —
// everything under apps/ and packages/ is linted via its own
// eslint.config.js through the Turborepo `lint` pipeline instead.
import { baseConfig } from "@magyarsportonline/config/eslint/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ["apps/**", "packages/**"],
  },
  {
    // scripts/demo.ts is a CLI tool — user-facing stdout output is its job.
    files: ["scripts/**/*.ts"],
    rules: {
      "no-console": "off",
    },
  },
];
