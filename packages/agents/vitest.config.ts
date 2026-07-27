import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    testTimeout: 15_000,
    // Több teszt-fájl is ugyanazt a valódi Postgres adatbázist használja
    // (truncateAllTables minden beforeEach-ben) — párhuzamos fájl-futtatás
    // mellett az egyik fájl TRUNCATE-je elkaphatja egy másik fájl épp
    // folyamatban lévő tranzakcióját. A fájlok közötti szekvenciális
    // futtatás (a fájlokon belüli tesztek továbbra is gyorsak) megszünteti
    // ezt a versenyhelyzetet.
    fileParallelism: false,
  },
});
