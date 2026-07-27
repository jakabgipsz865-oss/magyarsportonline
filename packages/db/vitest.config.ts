import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Több teszt-fájl is ugyanazt a valódi Postgres adatbázist használja —
    // lásd packages/agents/vitest.config.ts ugyanerről a döntésről.
    fileParallelism: false,
  },
});
