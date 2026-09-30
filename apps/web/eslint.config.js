// @ts-check
import { nextjsConfig } from "@magyarsportonline/config/eslint/nextjs";

/** @type {import("eslint").Linter.Config[]} */
export default [
  ...nextjsConfig,
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "cloudflare-generated.d.ts",
      "next-env.d.ts",
    ],
  },
];
