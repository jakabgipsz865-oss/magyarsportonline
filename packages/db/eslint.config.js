// @ts-check
import { baseConfig } from "@magyarsportonline/config/eslint/base";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...baseConfig,
  {
    ignores: ["drizzle/**"],
  },
];
