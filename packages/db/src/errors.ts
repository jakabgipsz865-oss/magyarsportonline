/**
 * Postgres unique-violation error code (23505), surfaced by the `postgres`
 * driver as `error.code`. Used by repositories that rely on a `UNIQUE`
 * constraint as the actual concurrency guard (e.g. slug assignment) instead
 * of an application-level existence check-then-insert, which would race.
 */
export function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
