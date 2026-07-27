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
