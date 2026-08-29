import type { Entity } from "@magyarsportonline/db";
import { extractLead, type ArticleForMentionExtraction } from "./entity-mentions";

const PREMIER_LEAGUE_TEAMS = new Set([
  "AFC Bournemouth",
  "Arsenal FC",
  "Aston Villa FC",
  "Brentford FC",
  "Brighton & Hove Albion FC",
  "Chelsea FC",
  "Coventry City FC",
  "Crystal Palace FC",
  "Everton FC",
  "Fulham FC",
  "Hull City AFC",
  "Ipswich Town FC",
  "Leeds United FC",
  "Liverpool FC",
  "Manchester City FC",
  "Manchester United FC",
  "Newcastle United FC",
  "Nottingham Forest FC",
  "Sunderland AFC",
  "Tottenham Hotspur FC",
]);

const ACCEPT_TERMS = [
  "transfer",
  "sign",
  "signing",
  "deal",
  "bid",
  "offer",
  "medical",
  "loan",
  "contract",
  "rumour",
  "rumor",
  "exclusive",
  "target",
  "interest",
  "approach",
  "agreement",
  "fee",
  "injury",
  "injured",
  "ruled out",
  "set to miss",
  "suspended",
  "ban",
  "return",
  "sack",
  "sacked",
  "manager",
  "head coach",
  "resign",
  "appointed",
  "appointment",
  "title",
  "relegation",
  "points deduction",
  "var",
  "red card",
  "takeover",
  "ownership",
  "psr",
];

const DROP_TERMS = [
  "betting tips",
  "odds",
  "accumulator",
  "acca",
  "fantasy football",
  "fpl",
  "quiz",
  "tickets",
  "hospitality",
  "how to watch",
  "podcast",
  "newsletter",
  "casino",
  "free bet",
  "sponsored content",
  "promotional content",
];

function containsPhrase(text: string, phrase: string): boolean {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, "iu").test(text);
}

function aliasesOf(entity: Entity): string[] {
  const aliases = Array.isArray(entity.aliases)
    ? entity.aliases.filter((alias): alias is string => typeof alias === "string")
    : [];
  return [entity.nameCanonical, ...aliases];
}

function hasCurrentTeam(text: string, entities: Entity[]): boolean {
  return entities
    .filter((entity) => entity.type === "team" && PREMIER_LEAGUE_TEAMS.has(entity.nameCanonical))
    .some((entity) => aliasesOf(entity).some((alias) => containsPhrase(text, alias)));
}

/** Conservative, deterministic gate: only obvious non-PL/promotional items are rejected. */
export function isPremierLeagueRelevant(
  article: ArticleForMentionExtraction,
  entities: Entity[],
): boolean {
  const lead = extractLead(article);
  const text = `${article.titleOriginal} ${lead}`;

  if (DROP_TERMS.some((term) => containsPhrase(text, term))) return false;
  if (containsPhrase(text, "Premier League")) return true;

  const teamInTitle = hasCurrentTeam(article.titleOriginal, entities);
  const teamInText = teamInTitle || hasCurrentTeam(lead, entities);
  return teamInText && (teamInTitle || ACCEPT_TERMS.some((term) => containsPhrase(text, term)));
}
