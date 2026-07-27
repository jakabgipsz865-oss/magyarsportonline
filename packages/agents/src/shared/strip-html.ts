const TAG_PATTERN = /<[^>]*>/g;
const ENTITY_PATTERN = /&(amp|lt|gt|quot|#39|apos|nbsp);/g;
const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&apos;": "'",
  "&nbsp;": " ",
};

/**
 * Minimal HTML-to-plain-text cleanup for RSS item bodies (roadmap Fázis 3,
 * 30. lépés: "parse & tisztítás"). Deliberately a regex-based tag strip, not
 * a full readability/boilerplate-removal pipeline — good enough for the
 * short RSS summaries the Source Ingest Agent handles; the Fact Verification
 * Agent works from the cleaned text, never the raw HTML.
 */
export function stripHtml(input: string): string {
  const withoutTags = input.replace(TAG_PATTERN, " ");
  const decoded = withoutTags.replace(ENTITY_PATTERN, (match) => ENTITIES[match] ?? match);
  return decoded.replace(/\s+/g, " ").trim();
}
