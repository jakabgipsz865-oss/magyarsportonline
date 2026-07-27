// @ts-check
import { nextjsConfig } from "@magyarsportonline/config/eslint/nextjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextjsConfig,
  {
    ignores: [".next/**", "next-env.d.ts"],
  },
];
