export interface EntityCandidate {
  id: string;
  nameCanonical: string;
  aliases: unknown;
}

/**
 * MVP entity extraction: case-insensitive substring match against a seeded
 * `entities` table (name + aliases) — no NER model. This is intentionally
 * limited (see docs/adr/0006-mvp-fingerprint-only-dedup.md): it only
 * recognizes entities that have been explicitly seeded, in exchange for
 * being simple, deterministic, and free of any external NLP/embedding
 * dependency.
 *
 * Ordering matters for callers: the first match is treated as the
 * "primary" entity for fingerprinting purposes, so entities are returned in
 * order of first appearance in the text.
 */
export function matchEntities(text: string, entities: EntityCandidate[]): EntityCandidate[] {
  const lowerText = text.toLowerCase();

  const matches = entities
    .map((entity) => {
      const names = [
        entity.nameCanonical,
        ...(Array.isArray(entity.aliases) ? entity.aliases : []),
      ].filter((name): name is string => typeof name === "string");

      const firstIndex = names.reduce<number>((earliest, name) => {
        const index = lowerText.indexOf(name.toLowerCase());
        if (index === -1) {
          return earliest;
        }
        return earliest === -1 ? index : Math.min(earliest, index);
      }, -1);

      return { entity, firstIndex };
    })
    .filter((candidate) => candidate.firstIndex !== -1);

  matches.sort((a, b) => a.firstIndex - b.firstIndex);
  return matches.map((candidate) => candidate.entity);
}
