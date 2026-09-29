import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";
import type { D1Client, D1Statement } from "@magyarsportonline/db/d1";
const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as {
  DatabaseSync: typeof DatabaseSyncType;
};
export function sqliteD1(
  migrations: string[] = ["0001_initial", "0002_qualified_read_trending", "0003_draft_recovery"],
): { db: DatabaseSyncType; d1: D1Client } {
  const db = new DatabaseSync(":memory:");
  for (const name of migrations)
    db.exec(
      readFileSync(new URL(`../../../../packages/db/d1/${name}.sql`, import.meta.url), "utf8"),
    );
  db.exec("PRAGMA foreign_keys=ON");
  const runs = new WeakMap<D1Statement, () => { meta: { changes: number } }>();
  const d1: D1Client = {
    prepare(query) {
      const stmt = db.prepare(query);
      let values: (string | number | null)[] = [];
      const bound: D1Statement = {
        bind(...v) {
          values = v.map((x) => (typeof x === "boolean" ? Number(x) : x));
          return this;
        },
        async first<T>() {
          return (stmt.get(...values) as T) ?? null;
        },
        async all<T>() {
          return { results: stmt.all(...values) as T[] };
        },
        async run() {
          return { meta: { changes: Number(stmt.run(...values).changes) } };
        },
      };
      runs.set(bound, () => ({ meta: { changes: Number(stmt.run(...values).changes) } }));
      return bound;
    },
    async batch(statements) {
      db.exec("BEGIN");
      try {
        const result = statements.map((s) => runs.get(s)!());
        db.exec("COMMIT");
        return result;
      } catch (e) {
        db.exec("ROLLBACK");
        throw e;
      }
    },
  };
  return { db, d1 };
}
