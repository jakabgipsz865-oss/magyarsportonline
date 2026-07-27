const COMBINING_DIACRITICAL_MARKS = /[̀-ͯ]/g;
const NON_ALPHANUMERIC = /[^a-z0-9]+/g;
const LEADING_TRAILING_HYPHENS = /^-+|-+$/g;
const MAX_SLUG_LENGTH = 80;

/** Deterministic, first-version-only slug generation (docs/architecture/02-agents.md §2.6). */
export function slugify(title: string): string {
  return title
    .normalize("NFD")
    .replace(COMBINING_DIACRITICAL_MARKS, "")
    .toLowerCase()
    .replace(NON_ALPHANUMERIC, "-")
    .replace(LEADING_TRAILING_HYPHENS, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(LEADING_TRAILING_HYPHENS, "");
}
