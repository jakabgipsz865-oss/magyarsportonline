/** Public clean slate starts with v2; legacy canonical data remains untouched. */
export const TABLOID_PUBLIC_PROMPT = "tabloid-hu@2";
export const TABLOID_PUBLIC_START = "2026-09-10T20:03:10.000Z";

export type TabloidSourceMode = "DIRECT_GOSSIP" | "BROAD_TABLOID_FOOTBALL";

/** Persisted in existing raw_articles JSONB; no schema migration needed. */
export interface TabloidEventDescriptor {
  baseKey: string;
  entity: string;
  eventType: string;
  concepts: string[];
  constraints: Record<string, string>;
}
export interface TabloidEventIdentity extends TabloidEventDescriptor {
  version: 1;
  fingerprint: string;
  canonicalRawId: string;
  firstAt: string;
  lastAt: string;
}
