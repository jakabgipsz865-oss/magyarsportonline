/** Deterministic checks for claims that can be compared without translation. */
interface NumericFact {
  key: string;
  raw: string;
  start: number;
  end: number;
  kind: "score" | "money" | "date" | "time" | "number";
}

const NUM = String.raw`\d+(?:[.,\s]\d+)*`;
const MONEY = new RegExp(
  String.raw`(?<![\p{L}\d])(${NUM})\s*(million|millió|milli[oó]n|billion|milliárd)?\s*(euros?|euró|eur|€|dollars?|dollár|usd|\$|pounds?|font|gbp|£)(?:nak|nek|val|vel|ért|ban|ben|ról|ről|ra|re|t)?(?!\p{L})`,
  "giu",
);
const DATE_ISO = /(?<!\d)(\d{4})[.\/-](\d{1,2})[.\/-](\d{1,2})(?!\d)/gu;
const DATE_DMY = /(?<!\d)(\d{1,2})[.\/-](\d{1,2})[.\/-](\d{4})(?!\d)/gu;
const TIME = /(?<!\d)(\d{1,2})[:.]([0-5]\d)(?!\d)/gu;
const SCORE = /(?<!\d)(\d{1,2})\s*[-–—:]\s*(\d{1,2})(?!\d)/gu;
const NUMBER = /(?<![\p{L}\d])\d+(?:[.,\s]\d+)*(?![\p{L}\d])/gu;
const ORDINAL = /(?<![\p{L}\d])(\d+)(?:st|nd|rd|th)(?!\p{L})/giu;

function amount(value: string): string {
  const compact = value.replace(/\s/g, "");
  const separator = compact.lastIndexOf(",") > compact.lastIndexOf(".") ? "," : ".";
  const parts = compact.split(separator);
  const last = parts.at(-1) ?? "";
  const decimal = parts.length > 1 && last.length !== 3;
  const digits = decimal
    ? `${parts.slice(0, -1).join("").replace(/[.,]/g, "")}.${last}`
    : compact.replace(/[.,]/g, "");
  const parsed = Number(digits);
  return Number.isFinite(parsed) ? String(parsed) : compact;
}

function moneyUnit(value: string): string {
  if (/^(€|eur|euró)/iu.test(value)) return "EUR";
  if (/^(\$|usd|doll)/iu.test(value)) return "USD";
  return "GBP";
}

function multiplier(value: string | undefined): number {
  if (!value) return 1;
  return /billion|milliárd/iu.test(value) ? 1_000_000_000 : 1_000_000;
}

function facts(text: string): NumericFact[] {
  const found: NumericFact[] = [];
  const occupied: Array<[number, number]> = [];
  function add(match: RegExpExecArray, kind: NumericFact["kind"], key: string) {
    const start = match.index;
    const end = start + match[0].length;
    if (occupied.some(([from, to]) => start < to && end > from)) return;
    found.push({ kind, key, raw: match[0], start, end });
    occupied.push([start, end]);
  }
  for (const match of text.matchAll(DATE_ISO))
    add(
      match as RegExpExecArray,
      "date",
      `${match[1]}-${match[2]!.padStart(2, "0")}-${match[3]!.padStart(2, "0")}`,
    );
  for (const match of text.matchAll(DATE_DMY))
    add(
      match as RegExpExecArray,
      "date",
      `${match[3]}-${match[2]!.padStart(2, "0")}-${match[1]!.padStart(2, "0")}`,
    );
  for (const match of text.matchAll(MONEY))
    add(
      match as RegExpExecArray,
      "money",
      `${Number(amount(match[1]!)) * multiplier(match[2])}:${moneyUnit(match[3]!)}`,
    );
  for (const match of text.matchAll(TIME)) {
    const context = text
      .slice(Math.max(0, match.index - 18), match.index)
      .toLocaleLowerCase("hu-HU");
    if (/\b(at|from|until|óra|órakor|time|kickoff|kezd|kor)\b/u.test(context))
      add(match as RegExpExecArray, "time", `${match[1]!.padStart(2, "0")}:${match[2]}`);
  }
  for (const match of text.matchAll(SCORE))
    add(match as RegExpExecArray, "score", `${match[1]}:${match[2]}`);
  for (const match of text.matchAll(ORDINAL))
    add(match as RegExpExecArray, "number", amount(match[1]!));
  for (const match of text.matchAll(NUMBER))
    add(match as RegExpExecArray, "number", amount(match[0]));
  return found.sort((a, b) => a.start - b.start);
}

function sharedNames(source: string, output: string): string[] {
  const names = new Set(source.match(/\b\p{Lu}[\p{L}'’-]{2,}\b/gu) ?? []);
  return [...names].filter((name) => output.includes(name));
}

function nearbyName(text: string, fact: NumericFact, names: string[]): string | null {
  let nearest: { name: string; distance: number } | null = null;
  for (const name of names) {
    for (const match of text.matchAll(
      new RegExp(`(?<!\\p{L})${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\p{L})`, "gu"),
    )) {
      const distance = fact.start - (match.index + name.length);
      const between = text.slice(match.index + name.length, fact.start);
      if (
        distance >= 0 &&
        distance <= 18 &&
        !/[.!?;\n]/u.test(between) &&
        (!nearest || distance < nearest.distance)
      )
        nearest = { name, distance };
    }
  }
  return nearest?.name ?? null;
}

function scoreWinner(text: string, score: NumericFact, names: string[]): string | null {
  const [left, right] = score.key.split(":");
  if (!left || !right) return null;
  const result = `${left}\\s*[-–—:]\\s*${right}`;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const winnerBeforeScore = new RegExp(
      `\\b${escaped}\\s+${result}(?:-ra|-re)?\\s+(?:verte|legyőzte|defeated|beat)\\b`,
      "iu",
    );
    const winnerBeforeOpponent = new RegExp(
      `\\b${escaped}\\s+(?:beat|defeated|verte|legyőzte)\\s+\\p{Lu}[\\p{L}'’-]{2,}\\s+${result}`,
      "iu",
    );
    if (winnerBeforeScore.test(text) || winnerBeforeOpponent.test(text)) return name;
  }
  return null;
}

export function unverifiedNumericClaims(source: string, output: string): string[] {
  const sourceFacts = facts(source);
  const outputFacts = facts(output);
  const names = sharedNames(source, output);
  const issues: string[] = [];
  for (const claim of outputFacts) {
    const candidates = sourceFacts.filter(
      (fact) => fact.kind === claim.kind && fact.key === claim.key,
    );
    if (candidates.length === 0) {
      issues.push(`${claim.kind}:${claim.raw}`);
      continue;
    }
    if (claim.kind === "score") {
      const sourceWinner = scoreWinner(source, candidates[0]!, names);
      const outputWinner = scoreWinner(output, claim, names);
      if (sourceWinner && outputWinner && sourceWinner !== outputWinner)
        issues.push(`assignment:${outputWinner}:${claim.raw}`);
    }
    if (claim.kind === "number") {
      const name = nearbyName(output, claim, names);
      if (
        name &&
        candidates.some((fact) => {
          const sourceName = nearbyName(source, fact, names);
          return sourceName !== null && sourceName !== name;
        }) &&
        !candidates.some((fact) => nearbyName(source, fact, names) === name)
      )
        issues.push(`assignment:${name}:${claim.raw}`);
    }
  }
  return [...new Set(issues)];
}
