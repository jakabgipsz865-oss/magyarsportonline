/**
 * Megosztott, AI-mentes tisztítási segédek minden forrás-specifikus
 * extractorhoz (2026-07-28-i "Source Fetcher" sprint) — tiszta
 * szöveg-feldolgozás, semmilyen LLM-hívás.
 */

/** Whitespace-normalizált szöveg, vagy `null` ha üresre trimmelődik. */
export function textOrNull(value: string | undefined | null): string | null {
  const trimmed = value?.replace(/\s+/g, " ").trim();
  return trimmed && trimmed.length > 0 ? trimmed : null;
}

/** Bekezdés-tömbből egy kettős-újsorral tagolt törzsszöveg — minden bekezdés önmagában is normalizálva, az üresek kiszűrve. */
export function joinParagraphs(paragraphs: string[]): string {
  return paragraphs
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter((paragraph) => paragraph.length > 0)
    .join("\n\n");
}
