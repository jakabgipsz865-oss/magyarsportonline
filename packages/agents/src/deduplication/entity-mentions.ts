import type { Entity } from "@magyarsportonline/db";
import type { MatchedEntity } from "./entity-matcher";

export type MentionLocation = "title" | "lead";

export interface EntityMention {
  entity: MatchedEntity;
  location: MentionLocation;
}

export interface ArticleForMentionExtraction {
  titleOriginal: string;
  subtitleOriginal: string | null;
  bodyOriginal: string;
}

/**
 * Known Sky Sports / BBC promotional-CTA sentence patterns that show up as
 * ordinary `<p>` elements inside the article body (so the extractor's
 * allow-list of body-paragraph selectors can't tell them apart from real
 * article text) — e.g. "Stream darts with NOW - contract-free", "Watch
 * Premier League and more with NOW", "Please use Chrome browser for a more
 * accessible video player". These are exactly what caused the real
 * production false-merge (docs/open-decisions.md #12 follow-up): a generic
 * "Premier League" mention buried in a footer CTA paragraph, repeated
 * near-verbatim across completely unrelated Sky Sports articles.
 */
const BOILERPLATE_PATTERNS: RegExp[] = [
  /^stream .* (with now|contract-free)/i,
  /^watch .* (live on sky sports|with now|and more)/i,
  /^get sky sports or stream/i,
  /^please use (chrome|a) browser/i,
  /^listen to the .* podcast/i,
  /^latest .* (news and video|highlights)/i,
];

function isBoilerplateParagraph(paragraph: string): boolean {
  const trimmed = paragraph.trim();
  return BOILERPLATE_PATTERNS.some((pattern) => pattern.test(trimmed));
}

/**
 * The article's lead: the extractor-provided subtitle/standfirst if present,
 * otherwise the first non-boilerplate paragraph of the body — never the
 * full body. Paragraphs are assumed to be joined the same way
 * `joinParagraphs` (source-ingest/article-fetcher/html-cleaning.ts) does,
 * i.e. separated by blank lines.
 */
export function extractLead(article: ArticleForMentionExtraction): string {
  if (article.subtitleOriginal && article.subtitleOriginal.trim().length > 0) {
    return article.subtitleOriginal;
  }
  const paragraphs = article.bodyOriginal.split(/\n\s*\n/);
  const firstReal = paragraphs.find((p) => p.trim().length > 0 && !isBoilerplateParagraph(p));
  return firstReal ?? "";
}

function findMatches(text: string, entities: Entity[]): MatchedEntity[] {
  const normalizedText = text.toLowerCase();
  const matches: MatchedEntity[] = [];
  for (const entity of entities) {
    const aliases = Array.isArray(entity.aliases)
      ? entity.aliases.filter((alias): alias is string => typeof alias === "string")
      : [];
    const candidates = [entity.nameCanonical, ...aliases];
    if (candidates.some((alias) => normalizedText.includes(alias.toLowerCase()))) {
      matches.push({ entityId: entity.id, type: entity.type, nameCanonical: entity.nameCanonical });
    }
  }
  return matches;
}

/**
 * Extracts every known entity mentioned in an article's TITLE and LEAD only
 * — deliberately never the full body (2026-07-29, "téves Story-összevonás
 * megszüntetése" sprint, rules 3+4). Boilerplate/CTA content that leaks into
 * `bodyOriginal` as ordinary paragraphs can never influence a match this
 * way, and the title/lead genuinely carry more of an article's real subject
 * than any one paragraph buried in the body.
 *
 * An entity found in the title keeps its "title" location even if it also
 * appears in the lead (title wins — it's the strongest signal).
 */
export function extractEntityMentions(
  article: ArticleForMentionExtraction,
  entities: Entity[],
): EntityMention[] {
  const titleMatches = findMatches(article.titleOriginal, entities);
  const lead = extractLead(article);
  const leadMatches = findMatches(lead, entities);

  const byEntityId = new Map<string, EntityMention>();
  for (const entity of leadMatches) {
    byEntityId.set(entity.entityId, { entity, location: "lead" });
  }
  for (const entity of titleMatches) {
    byEntityId.set(entity.entityId, { entity, location: "title" });
  }
  return [...byEntityId.values()];
}
