/** Minimal structural subset of the Cloudflare D1 binding used by repositories. */
export interface D1Statement {
  bind(...values: (string | number | boolean | null)[]): D1Statement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface D1Client {
  prepare(query: string): D1Statement;
}

/** PostgreSQL exports use six fractional digits and +00:00 UTC. */
export function d1Timestamp(date: Date): string {
  return date.toISOString().replace("Z", "000+00:00");
}

export function d1Date(value: string | null): Date | null {
  return value === null ? null : new Date(value);
}
