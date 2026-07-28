import type { Entity } from "@magyarsportonline/db";

export interface MatchedEntity {
  entityId: string;
  type: string;
  nameCanonical: string;
}

/** Entity types typically named first/most-prominently in a football headline, checked in this order. */
const TYPE_PRIORITY: Record<string, number> = {
  team: 0,
  player: 1,
  competition: 2,
  league: 3,
  venue: 4,
};

function aliasesOf(entity: Entity): string[] {
  const aliases = Array.isArray(entity.aliases)
    ? entity.aliases.filter((alias): alias is string => typeof alias === "string")
    : [];
  return [entity.nameCanonical, ...aliases];
}

/**
 * Whether an Entity's canonical name or any alias appears (case-insensitively)
 * in the given text — the read-side counterpart to `matchPrimaryEntity`,
 * used by the web app to find which published Stories mention a given
 * team/competition without needing a populated `story_entities` table (which
 * no agent currently writes to).
 */
export function entityMatchesText(entity: Entity, text: string): boolean {
  const normalizedText = text.toLowerCase();
  return aliasesOf(entity).some((alias) => normalizedText.includes(alias.toLowerCase()));
}

/**
 * Deterministic alias-lookup entity matcher — the MVP substitute for a real
 * NER model (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 3). Picks
 * the single "primary" entity a coarse fingerprint can key off of: the
 * highest-priority type among every entity whose name/alias appears
 * (case-insensitively) in the given text.
 */
export function matchPrimaryEntity(text: string, entities: Entity[]): MatchedEntity | null {
  const normalizedText = text.toLowerCase();
  const candidates = entities.filter((entity) =>
    aliasesOf(entity).some((alias) => normalizedText.includes(alias.toLowerCase())),
  );
  if (candidates.length === 0) {
    return null;
  }

  candidates.sort((a, b) => (TYPE_PRIORITY[a.type] ?? 9) - (TYPE_PRIORITY[b.type] ?? 9));
  const winner = candidates[0];
  if (!winner) {
    return null;
  }
  return { entityId: winner.id, type: winner.type, nameCanonical: winner.nameCanonical };
}
