import { it, expect } from "vitest";
import fixtures from "./tabloid-expanded-preview-fixtures.json";
import { memoryEvents } from "./tabloid-event-test-helper";
import { resolveTabloidEvent } from "./tabloid-event";
// Exact persisted Preview RSS text. Positive editorial event labels are expectations,
// not output from the matcher; a failure must remain visible as a coverage gap.
it.each(fixtures)("additional real cross-source event: $event", async ({ articles }) => {
  const repo = memoryEvents();
  const results = [];
  for (const row of articles)
    results.push(
      await resolveTabloidEvent(
        {
          ...row,
          publishedAt: row.publishedAt ? new Date(row.publishedAt) : null,
          ingestedAt: new Date(row.ingestedAt),
        },
        repo,
      ),
    );
  expect(new Set(articles.map((a) => a.sourceId)).size).toBeGreaterThan(1);
  expect(new Set(results.map((r) => r.fingerprint)).size).toBe(1);
});
