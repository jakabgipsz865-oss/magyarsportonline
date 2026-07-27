import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // Üres tesztkészlet mellett a `test` script ne bukjon el, de ne is
    // adjon hamis "sikeres" benyomást valódi lefedettségről egy olyan
    // jövőbeli állapotban, ahol megint nincs egyetlen teszt sem.
    passWithNoTests: true,
    // lib/stories.test.ts ugyanazt a valódi Postgres adatbázist használja,
    // mint packages/db és packages/agents — lásd packages/agents/vitest.config.ts.
    fileParallelism: false,
  },
});
