import type { Entity } from "@magyarsportonline/db";
import { extractEntityMentions } from "../deduplication/entity-mentions";
import { headlineSimilarity } from "../deduplication/story-match";

export type MatchContributionType = "corroboration" | "new_info";
export const CORROBORATION_HEADLINE_THRESHOLD = 0.75;

const STATUS_SIGNALS: Array<[string, RegExp]> = [
  ["confirmed", /\b(?:official(?:ly)?|confirm(?:ed|s)?)\b/iu],
  ["agreement", /\b(?:agree(?:d|s)?|agreement|deal)\b/iu],
  ["bid", /\bbid\b/iu],
  ["medical", /\bmedical\b/iu],
  ["contract", /\bcontract\b/iu],
  ["fee", /\bfee\b/iu],
  ["injury", /\b(?:injury|injured|ruled out|set to miss)\b/iu],
  ["suspension", /\b(?:suspended|suspension|ban(?:ned)?)\b/iu],
];

const NUMBER_SIGNAL =
  /\d+\s*[-:–]\s*\d+|(?:£|€|\$)\s*\d+(?:[.,]\d+)?(?:\s?(?:m|bn|k|million|billion))?|\b\d+(?:[.,]\d+)?\s?(?:m|bn|k|million|billion|years?|months?|weeks?|days?)\b|\b\d{1,4}\b/giu;
const WORD_DURATION_SIGNAL =
  /\b(?:one|two|three|four|five|six|seven|eight|nine|ten)[ -](?:year|month|week|day)s?\b/giu;

function materialSignals(title: string, entities: Entity[]): Set<string> {
  const signals = new Set<string>();
  const mentions = extractEntityMentions(
    { titleOriginal: title, subtitleOriginal: null, bodyOriginal: "" },
    entities,
  );
  for (const mention of mentions) signals.add(`entity:${mention.entity.entityId}`);
  for (const [name, pattern] of STATUS_SIGNALS) {
    if (pattern.test(title)) signals.add(`status:${name}`);
  }
  for (const match of title.match(NUMBER_SIGNAL) ?? []) {
    signals.add(`number:${match.toLowerCase().replace(/[\s,–]/g, "")}`);
  }
  for (const match of title.match(WORD_DURATION_SIGNAL) ?? []) {
    signals.add(`duration:${match.toLowerCase().replace(/\s/g, "-")}`);
  }
  return signals;
}

export function classifyMatchContribution(
  newTitle: string,
  existingTitle: string,
  entities: Entity[],
): MatchContributionType {
  if (headlineSimilarity(newTitle, existingTitle) < CORROBORATION_HEADLINE_THRESHOLD) {
    return "new_info";
  }

  const existingSignals = materialSignals(existingTitle, entities);
  const hasNewSignal = [...materialSignals(newTitle, entities)].some(
    (signal) => !existingSignals.has(signal),
  );
  return hasNewSignal ? "new_info" : "corroboration";
}
