import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // Integration tests share the local scratch database and reset their own tables.
    fileParallelism: false,
  },
});
