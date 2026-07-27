import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["**/*.test.ts", "**/*.test.tsx"],
    // A Fázis 0 még nem tartalmaz tesztelendő üzleti logikát a frontendben
    // (a Story-oldalak a Fázis 9-ben készülnek el) — üres tesztkészlet mellett
    // a `test` script ne bukjon el, de ne is adjon hamis "sikeres" benyomást
    // valódi lefedettségről.
    passWithNoTests: true,
  },
});
