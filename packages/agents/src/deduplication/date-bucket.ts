/** Day-granularity bucket for the fingerprint (docs/architecture/03-event-flow.md §3.7). */
export function formatDateBucket(date: Date): string {
  return date.toISOString().slice(0, 10);
}
