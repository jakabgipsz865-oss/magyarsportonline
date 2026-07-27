// @ts-check
import reactHooks from "eslint-plugin-react-hooks";
import { baseConfig } from "./base.js";

/**
 * ESLint flat config for Next.js apps, layered on top of the shared base config.
 * Deliberately does not depend on `eslint-config-next` (which still ships a
 * `.eslintrc`-style config incompatible with flat config in this dependency
 * set) — only the rules we actually want (React Hooks correctness) are added.
 * @type {import("eslint").Linter.Config[]}
 */
export const nextjsConfig = [
  ...baseConfig,
  {
    plugins: {
      "react-hooks": reactHooks,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
    },
  },
];

export default nextjsConfig;
