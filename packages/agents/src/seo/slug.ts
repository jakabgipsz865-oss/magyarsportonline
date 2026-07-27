// Unicode "Combining Diacritical Marks" block (U+0300-U+036F) — matches accents
// left behind by NFD normalization (e.g. "á" -> "a" + U+0301).
const COMBINING_DIACRITICS = new RegExp("[\\u0300-\\u036f]", "g");

/**
 * Deterministic slug generation (docs/architecture/02-agents.md §2.6):
 * accent removal via Unicode NFD normalization (correctly reduces Hungarian
 * á/é/í/ó/ö/ő/ú/ü/ű to their base Latin letters, since each decomposes into
 * a base character + combining accent), lowercased, non-alphanumeric runs
 * collapsed to a single hyphen.
 */
export function slugify(input: string): string {
  const base = input
    .normalize("NFD")
    .replace(COMBINING_DIACRITICS, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100)
    .replace(/-+$/g, "");
  return base || "hir";
}
