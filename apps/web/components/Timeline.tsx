import type { ReactNode } from "react";
import type { VersionHistoryEntry } from "@/lib/stories";

function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Renders the Story's version history — the "Frissítések" section from
 * docs/architecture/01-data-model.md §1.6, one of the core product
 * differentiators the MVP explicitly had to demonstrate.
 */
export function Timeline({ entries }: { entries: VersionHistoryEntry[] }): ReactNode {
  if (entries.length === 0) {
    return null;
  }

  const sorted = [...entries].sort((a, b) => b.versionNumber - a.versionNumber);

  return (
    <section aria-label="Frissítések">
      <h2>Frissítések</h2>
      <ol className="timeline">
        {sorted.map((entry) => (
          <li key={entry.versionNumber}>
            <span className="timeline-version">v{entry.versionNumber}</span>{" "}
            <time dateTime={entry.createdAt}>{formatTimestamp(entry.createdAt)}</time>
            {entry.changeSummary ? <p>{entry.changeSummary}</p> : null}
          </li>
        ))}
      </ol>
    </section>
  );
}
