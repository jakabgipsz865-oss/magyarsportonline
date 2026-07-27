/** Day-granularity UTC bucket for the fingerprint (docs/architecture/01-data-model.md §1.5.1: "day-granularity string, e.g. \"2026-07-27\""). */
export function toDateBucket(date: Date): string {
  const iso = date.toISOString();
  return iso.slice(0, 10);
}
