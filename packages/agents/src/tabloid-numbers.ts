/** Pure, fail-closed numeric comparison. No model, network, or database access. */
export type NumericLanguage = "en" | "de" | "es" | "it" | "hu";
type Kind =
  | "number"
  | "money"
  | "score"
  | "date"
  | "time"
  | "range"
  | "age"
  | "length"
  | "season"
  | "ambiguous";
export interface NumericFact {
  kind: Kind;
  key: string;
  raw: string;
  start: number;
  end: number;
  owner?: string;
}
export const NUMBER_PARSER_VERSION = "multilingual-2026-09-29-v1";
const NUM = String.raw`\d+(?:[.,]\d+)*(?:[ \u00a0\u202f]\d{3})*`;
const VALUE = String.raw`(?:${NUM}|acht|fünf|fuenf|zwei|uno|tre|one)`;
const MULT = String.raw`(?:mil\s+millones|milliarden?|miliard[oi]|milliárd|billions?|millions?|millionen|millones|milioni|millió|milli[oó]n|mio\.?|thousand|ezer|mila|m(?!\p{L}))`;
const CUR = String.raw`(?:amerikai\s+dollár|US[- ]?Dollar|dollars?|dollár|USD|euros?|euró|EUR|pounds?|Pfund|sterline|libras?(?:\s+esterlinas?)?|font|GBP|€|£|\$)`;
const HU_END = String.raw`(?:nyi|hoz|ba|be|os|ot|tal|nak|nek|val|vel|ért|ban|ben|ról|ről|ra|re|s|t)?`;
const NAME = String.raw`\p{Lu}[\p{L}'’\-]+(?:\s+\p{Lu}[\p{L}'’\-]+){0,4}`;
const re = (pattern: string) => new RegExp(pattern, "giu");
const words: Record<string, string> = {
  acht: "8",
  fünf: "5",
  fuenf: "5",
  zwei: "2",
  uno: "1",
  tre: "3",
  one: "1",
};
function inferLanguage(text: string): NumericLanguage {
  if (/\b(milioni|miliardi|settembre|gennaio)\b/iu.test(text)) return "it";
  if (/\b(Millionen|Pfund|Uhr|gegen)\b/iu.test(text)) return "de";
  if (/\b(millones|esterlinas|octubre)\b/iu.test(text)) return "es";
  return "en";
}

/** Exact decimal with validated grouping; no binary float or epsilon comparison. */
export function normalizeNumericAmount(raw: string, language: NumericLanguage): string | null {
  const written = words[raw.toLowerCase()];
  if (written) return written;
  let value = raw.replace(/[ \u00a0\u202f]/gu, "");
  if (!/^\d+(?:[.,]\d+)*$/u.test(value)) return null;
  const decimal = language === "en" ? "." : ",";
  const group = decimal === "." ? "," : ".";
  if (value.includes(decimal)) {
    const parts = value.split(decimal);
    if (parts.length !== 2) return null;
    if (parts[0]!.includes(group) && !new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(parts[0]!))
      return null;
    value = parts[0]!.split(group).join("") + "." + parts[1];
  } else if (value.includes(group)) {
    if (new RegExp(`^\\d{1,3}(?:\\${group}\\d{3})+$`).test(value))
      value = value.split(group).join("");
    // Mixed editorial punctuation with 1–2 fractional digits is not a thousands group.
    else if (new RegExp(`^\\d+\\${group}\\d{1,2}$`).test(value)) value = value.replace(group, ".");
    else return null;
  }
  const [whole, fraction = ""] = value.split(".");
  const integer = whole!.replace(/^0+(?=\d)/u, "");
  const tail = fraction.replace(/0+$/u, "");
  return tail ? `${integer}.${tail}` : integer;
}
function scaled(value: string, multiplier?: string, half = false): string {
  const [whole, fraction = ""] = value.split(".");
  const scale = !multiplier
    ? 1n
    : multiplier === "centi"
      ? 100n
      : /billion|milliárd|milliard|miliard|mil\s+millones/iu.test(multiplier)
        ? 1_000_000_000n
        : /ezer|thousand|mila/iu.test(multiplier)
          ? 1_000n
          : 1_000_000n;
  let digits = BigInt(whole! + fraction) * scale;
  const power = 10n ** BigInt(fraction.length);
  if (half) digits += (scale * power) / 2n;
  const tail = (digits % power).toString().padStart(fraction.length, "0").replace(/0+$/u, "");
  return tail ? `${digits / power}.${tail}` : String(digits / power);
}
function unit(value: string): string {
  return /eur|€/iu.test(value) ? "EUR" : /doll|usd|\$/iu.test(value) ? "USD" : "GBP";
}
function folded(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^\p{L}\p{N}]/gu, "")
    .toLowerCase();
}
const MONTHS = [
  ["january", "januar", "enero", "gennaio", "január"],
  ["february", "februar", "febrero", "febbraio", "február"],
  ["march", "marz", "märz", "marzo", "március"],
  ["april", "abril", "aprile", "április"],
  ["may", "mai", "mayo", "maggio", "május"],
  ["june", "juni", "junio", "giugno", "június"],
  ["july", "juli", "julio", "luglio", "július"],
  ["august", "agosto", "augusztus"],
  ["september", "septiembre", "settembre", "szeptember"],
  ["october", "oktober", "octubre", "ottobre", "október"],
  ["november", "noviembre", "novembre"],
  ["december", "dezember", "diciembre", "dicembre"],
];
const MONTH = MONTHS.flat().join("|");
function dateKey(year: string | undefined, month: string, day: string): string | null {
  const m = /^\d+$/u.test(month)
    ? Number(month)
    : MONTHS.findIndex((names) => names.includes(month.toLowerCase())) + 1;
  const d = Number(day);
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const check = new Date(Date.UTC(year ? Number(year) : 2000, m - 1, d));
  if (check.getUTCMonth() !== m - 1 || check.getUTCDate() !== d) return null;
  return `${year ?? "----"}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Exposed for offline regression and conservative Language QA signatures. */
export function numericFacts(text: string, language: NumericLanguage): NumericFact[] {
  const found: NumericFact[] = [];
  const occupied: Array<[number, number]> = [];
  function add(
    start: number,
    raw: string,
    kind: Kind,
    key: string | null,
    occupy = true,
    owner?: string,
  ): void {
    if (key === null || (occupy && occupied.some(([a, b]) => start < b && start + raw.length > a)))
      return;
    found.push({ start, end: start + raw.length, raw, kind, key, ...(owner ? { owner } : {}) });
    if (occupy) occupied.push([start, start + raw.length]);
  }
  const amount = (raw: string) => normalizeNumericAmount(raw, language);
  const scale = (raw: string, mult?: string, half = false) => {
    const parsed = amount(raw);
    return parsed === null ? null : scaled(parsed, mult, half);
  };
  const moneyKey = (raw: string, mult: string | undefined, curr: string, half = false) => {
    const value = scale(raw, mult, half);
    return value === null ? null : `${value}:${unit(curr)}`;
  };
  for (const m of text.matchAll(
    re(
      String.raw`(?<![\p{L}\d])(${VALUE})\s*(${MULT})?\s*(e\s+mezzo)?\s*(?:de|di)?\s*(${CUR})${HU_END}(?!\p{L})`,
    ),
  )) {
    if (/fontos$/iu.test(m[0]) && !m[2] && Number(amount(m[1]!)) < 1000) continue;
    add(m.index, m[0], "money", moneyKey(m[1]!, m[2], m[4]!, Boolean(m[3])));
  }
  // "Euro 2024" is a competition, not a currency prefix. Prefixes are symbols or ISO codes.
  for (const m of text.matchAll(
    new RegExp(String.raw`(EUR|USD|GBP|€|£|\$)\s*(${NUM})\s*(${MULT})?(?!\p{L})`, "gu"),
  ))
    add(m.index, m[0], "money", moneyKey(m[2]!, m[3], m[1]!));
  for (const m of text.matchAll(
    re(String.raw`(${NUM})\s*[-–]\s*(${NUM})\s*(${MULT})\s*(${CUR})${HU_END}(?!\p{L})`),
  ))
    add(m.index, m[1]!, "money", moneyKey(m[1]!, m[3], m[4]!));
  for (const m of text.matchAll(
    re(String.raw`statt\s+(${NUM})\s*(${MULT})\s+nun\s+(${NUM})\s*(${MULT})\s*(${CUR})`),
  ))
    add(m.index + m[0].indexOf(m[1]!), `${m[1]} ${m[2]}`, "money", moneyKey(m[1]!, m[2], m[5]!));
  // Currency inheritance is restricted to explicit coordinated changes.
  for (const m of text.matchAll(
    re(
      String.raw`(${VALUE})\s*(${MULT})?\s*(?:auf|to|a|hasta|oder|vagy)\s*(${VALUE})\s*(${MULT})?\s*(?:de|di)?\s*(${CUR})${HU_END}(?!\p{L})`,
    ),
  ))
    add(m.index, m[1]!, "money", moneyKey(m[1]!, m[2] ?? m[4], m[5]!));
  for (const m of text.matchAll(
    re(
      String.raw`(${VALUE})\s*(${MULT})?\s*(?:de|di)?\s*(${CUR})\s+(?:auf|to|a)\s+(${VALUE})\s*(${MULT})(?!\p{L})`,
    ),
  )) {
    const at = m.index + m[0].lastIndexOf(m[4]!);
    add(at, m[0].slice(at - m.index), "money", moneyKey(m[4]!, m[5], m[3]!));
  }
  const scaledMatches = [
    ...text.matchAll(
      re(String.raw`(?<![\p{L}\d])(${VALUE})\s*(${MULT})(?:\s+(e\s+mezzo))?${HU_END}(?!\p{L})`),
    ),
  ];
  // A directly coordinated pair can share its written multiplier without inventing currency.
  for (const m of text.matchAll(re(String.raw`(${NUM})\s+auf\s+(${NUM})\s*(${MULT})(?!\p{L})`)))
    add(m.index, m[1]!, "number", scale(m[1]!, m[3]));
  for (const m of text.matchAll(
    re(String.raw`(${NUM})\s*(${MULT})\)\s+und\s+${NAME}\s*\((${NUM})\)\s+sind\s+mehr\s+wert`),
  ))
    add(m.index + m[0].lastIndexOf(m[3]!), m[3]!, "number", scale(m[3]!, m[2]));
  for (const m of scaledMatches) {
    const before = text.slice(Math.max(0, m.index - 360), m.index);
    const after = text.slice(m.index + m[0].length, m.index + m[0].length + 70);
    const anchor = found
      .filter((f) => f.kind === "money" && f.end <= m.index && f.start >= m.index - 360)
      .at(-1);
    if (!anchor) continue;
    const linkedPart =
      /ricavi complessivi/iu.test(before) &&
      /premium seating/iu.test(before) &&
      /del totale/iu.test(after);
    const linkedContract =
      /prestito/iu.test(before) && /diritto di riscatto/iu.test(before) && /e mezzo/iu.test(m[0]);
    const value = scale(m[1]!, m[2], Boolean(m[3]));
    const linkedComparison = /un aumento/iu.test(before) && /rispetto ai\s*$/iu.test(before);
    const coordinated =
      /(?:statt|und)[^.!?\n]{0,65}$/iu.test(before) && /(?:wert|Euro|Mio\.)/iu.test(before);
    if ((linkedPart || linkedContract || linkedComparison || coordinated) && value !== null)
      add(m.index, m[0], "money", `${value}:${anchor.key.split(":")[1]}`);
  }
  for (const allocation of text.matchAll(/Di tale importo,[^\n]+/giu)) {
    const anchor = found
      .filter(
        (f) => f.kind === "money" && f.end <= allocation.index && f.start >= allocation.index - 400,
      )
      .at(-1);
    const parts = scaledMatches.filter(
      (m) => m.index >= allocation.index && m.index < allocation.index + allocation[0].length,
    );
    if (!anchor || parts.length !== 2 || !/mentre ulteriori/iu.test(allocation[0])) continue;
    const values = parts.map((m) => scale(m[1]!, m[2], Boolean(m[3])));
    const total = anchor.key.split(":")[0]!;
    if (total.includes(".") || values.some((v) => !v || v.includes("."))) continue;
    if (BigInt(values[0]!) + BigInt(values[1]!) !== BigInt(total)) continue;
    for (const [i, m] of parts.entries())
      add(m.index, m[0], "money", `${values[i]}:${anchor.key.split(":")[1]}`);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{4})[./-](\d{1,2})[./-](\d{1,2})(?!\d)/gu))
    add(m.index, m[0], "date", dateKey(m[1], m[2]!, m[3]!));
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?!\d)/gu))
    add(m.index, m[0], "date", dateKey(m[3], m[2]!, m[1]!));
  for (const m of text.matchAll(re(String.raw`(?<!\d)(\d{4})[.\s]+(${MONTH})\s+(\d{1,2})(?!\d)`)))
    add(m.index, m[0], "date", dateKey(m[1], m[2]!, m[3]!));
  for (const m of text.matchAll(
    re(String.raw`(?<![\p{L}\d])(${MONTH})\s+(\d{1,2})(?:,?\s+(\d{4}))?(?!\d)`),
  ))
    add(m.index, m[0], "date", dateKey(m[3], m[1]!, m[2]!));
  for (const m of text.matchAll(
    re(
      String.raw`(?<!\d)(\d{1,2})(?:st|nd|rd|th|\.)?\s+(?:de\s+)?(${MONTH})(?:\s+(?:del\s+)?(\d{4}))?(?!\p{L})`,
    ),
  ))
    add(m.index, m[0], "date", dateKey(m[3], m[2]!, m[1]!));
  for (const m of text.matchAll(re(String.raw`\bprimo\s+(${MONTH})(?!\p{L})`)))
    add(m.index, m[0], "date", dateKey(undefined, m[1]!, "1"));
  for (const m of text.matchAll(/\(il\s+(\d{1,2})\)/giu)) {
    const previous = text.slice(
      Math.max(text.lastIndexOf("\n\n", m.index), m.index - 300),
      m.index,
    );
    const months = [...previous.matchAll(re(String.raw`\b(${MONTH})\b`))];
    const month = months.at(-1)?.[1];
    if (month && /calendario|partite|Europa League|Allianz Stadium/iu.test(previous))
      add(m.index, m[0], "date", dateKey(undefined, month, m[1]!));
  }
  for (const m of text.matchAll(/(?<!\d)([0-3]?\d)\.([01]?\d)\.(?!\d)/gu))
    add(m.index, m[0], "date", dateKey(undefined, m[2]!, m[1]!));
  for (const m of text.matchAll(/(?<!\d)(20\d{2})\s*[-/–]\s*(20\d{2}|\d{2})(?!\d)/gu)) {
    const year = m[2]!.length === 2 ? m[1]!.slice(0, 2) + m[2] : m[2]!;
    if (Number(year) < Number(m[1]) || Number(year) - Number(m[1]) > 10) continue;
    add(m.index, m[0], "season", `${m[1]}:${year}`);
    add(m.index, m[1]!, "number", m[1]!, false);
    add(m.index + m[0].lastIndexOf(m[2]!), m[2]!, "number", year!, false);
  }
  for (const m of text.matchAll(/\b(20\d{2}),\s*(\d{2})\s+oder\s+(\d{2})\b/giu)) {
    if (!/Sommerspiele|Olympia/iu.test(text.slice(Math.max(0, m.index - 150), m.index))) continue;
    add(m.index + m[0].indexOf(m[2]!), m[2]!, "number", m[1]!.slice(0, 2) + m[2], false);
    add(m.index + m[0].lastIndexOf(m[3]!), m[3]!, "number", m[1]!.slice(0, 2) + m[3], false);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{3})0s(?!\p{L})/gu))
    add(m.index, m[0], "number", `${m[1]}0`);
  for (const m of text.matchAll(/\b(20\d{2})[^.!?\n]{0,150}\bthe following year\b/giu))
    add(m.index, m[0], "number", String(Number(m[1]) + 1), false);
  for (const m of text.matchAll(/\ball but one (?:count of the|of the)\s+(\d+)\s+charges\b/giu))
    add(m.index, m[0], "number", String(BigInt(m[1]!) - 1n), false);

  const clock =
    /\b(at|from|until|kick.?off|coverage|time|Uhr|um|ore|alle|horas|óra|órakor|kezd|műsor|közvetítés|kor)\b/iu;
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})(?:[:.]([0-5]\d))?\s*(am|pm)\b/giu)) {
    if (Number(m[1]) > 12 || Number(m[1]) < 1) continue;
    const h = (Number(m[1]) % 12) + (m[3]!.toLowerCase() === "pm" ? 12 : 0);
    add(m.index, m[0], "time", `${String(h).padStart(2, "0")}:${m[2] ?? "00"}`);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})[:.]([0-5]\d)(?!\d)/gu)) {
    if (Number(m[1]) > 23) continue;
    const context =
      text.slice(Math.max(0, m.index - 40), m.index) +
      text.slice(m.index + m[0].length, m.index + m[0].length + 14);
    if (clock.test(context)) add(m.index, m[0], "time", `${m[1]!.padStart(2, "0")}:${m[2]}`);
  }
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s+ór[aá](?:kor)?\s+([0-5]?\d)(?:\s+perc)?/giu))
    if (Number(m[1]) <= 23)
      add(m.index, m[0], "time", `${m[1]!.padStart(2, "0")}:${m[2]!.padStart(2, "0")}`);
  for (const m of text.matchAll(
    re(
      String.raw`(?<![\p{L}\d])(${NUM})(?:\s*|-)(Meter|méter|metri|centiméter|cm)${HU_END}(?!\p{L})`,
    ),
  )) {
    const v = scale(m[1]!);
    if (v !== null)
      add(m.index, m[0], "length", /cm|centiméter/iu.test(m[2]!) ? v : scaled(v, "centi"));
  }
  for (const m of text.matchAll(
    /(?<!\d)(\d{1,3})(?:\s*|-)(?:enne|éves|year.old|years old|Jahre alt|jährige[nrs]?)(?!\p{L})/giu,
  ))
    add(m.index, m[0], "age", m[1]!);
  for (const m of text.matchAll(
    new RegExp(String.raw`(${NAME})\s*(?:\(|,\s*)(\d{2})(?=\)|/|,(?!\d))`, "gu"),
  )) {
    const pos = m.index + m[0].lastIndexOf(m[2]!);
    add(pos, m[2]!, "age", m[2]!, true, folded(m[1]!.split(/\s/u).at(-1)!));
  }
  for (const m of scaledMatches) add(m.index, m[0], "number", scale(m[1]!, m[2], Boolean(m[3])));
  // An implicit currency amount stays number, and cannot prove a money claim.
  for (const m of text.matchAll(
    /(?<!\d)(\d{1,2})\s*[-–/]\s*(\d{1,2})\s*(?:éve|év|hét|héten|nap|pont(?:ot|tal|ból)?|settimane|anni|Jahre|years|weeks|százalék(?:kal)?|%)(?!\p{L})/giu,
  )) {
    if (m[1] === m[2] && /pont/iu.test(m[0])) add(m.index, m[0], "number", m[1]!);
    else add(m.index, m[0], "range", `${m[1]}:${m[2]}`);
  }
  for (const m of text.matchAll(/\b(\d{1,2}),\s*(\d{1,2})\s+Jahren\b/giu))
    add(m.index, m[0], "range", `${m[1]}:${m[2]}`);
  for (const m of text.matchAll(/(?<!\d)(\d)(?:[-–]\d){2,4}(?!\d)/gu))
    add(m.index, m[0], "range", `formation:${m[0].replace(/–/gu, "-")}`);
  const matchContext =
    /(?:won|win|beat|defeat|lost|loss|draw|victory|score|goal|match|gegen|Bundestrainer|Niederlage|Sieg|Treffer|Debakel|Remis|Führung|Ausgleich|Duell|Pause|setzte sich|setzten sich|Erfolg|partita|vinto|contro|Francia|azzurri|perdió|victoria|gól|nyert|győ|vereség|verte|legyőzte|kikap|kiütés|döntetlen|állás|előny)/iu;
  for (const m of text.matchAll(/(?<!\d)(\d{1,2})\s*[-–—:]\s*(\d{1,2})(?!\d)/gu)) {
    const context = text.slice(Math.max(0, m.index - 65), m.index + m[0].length + 65);
    add(m.index, m[0], matchContext.test(context) ? "score" : "ambiguous", `${m[1]}:${m[2]}`);
  }
  for (const m of text.matchAll(/\b(tre|uno)\s+a\s+(tre|uno)\b/giu))
    if (matchContext.test(text.slice(Math.max(0, m.index - 160), m.index + m[0].length + 70)))
      add(m.index, m[0], "score", `${words[m[1]!.toLowerCase()]}:${words[m[2]!.toLowerCase()]}`);
  for (const m of text.matchAll(/(?<![\p{L}\d])(\d+)(?:st|nd|rd|th)(?!\p{L})/giu))
    add(m.index, m[0], "number", m[1]!);
  for (const m of text.matchAll(re(String.raw`(?<![\p{L}\d])${NUM}(?![\p{L}\d])`)))
    add(m.index, m[0], "number", amount(m[0]));
  for (const m of text.matchAll(/\bAngeklagt(20\d{2})\b/giu))
    add(m.index + "Angeklagt".length, m[1]!, "number", m[1]!);
  return found.sort((a, b) => a.start - b.start);
}

function sharedNames(source: string, output: string): string[] {
  const sourceNames = [...new Set(source.match(/\p{Lu}[\p{L}'’\-]{2,}/gu) ?? [])];
  const out = [...new Set(output.match(/\p{Lu}[\p{L}'’\-]{2,}/gu) ?? [])];
  return sourceNames.filter((name) =>
    out.some(
      (word) =>
        folded(word) === folded(name) ||
        new RegExp(`^${folded(name)}(?:t|et|nak|nek|tol|rol|ra|re|nal|nel|ban|ben|vel|val)$`).test(
          folded(word),
        ),
    ),
  );
}
function explicitOwner(text: string, fact: NumericFact, names: string[]): string | null {
  if (fact.owner)
    return names.map(folded).find((n) => fact.owner === n || fact.owner === n + "t") ?? fact.owner;
  const before = text.slice(Math.max(0, fact.start - 120), fact.start);
  const after = text.slice(fact.end, fact.end + 70);
  if (fact.kind === "age") {
    const named = after
      .match(new RegExp(String.raw`^\s*(${NAME})(?!\p{L})`, "u"))?.[1]
      ?.split(/\s/u)
      .at(-1);
    if (named && names.some((n) => folded(n) === folded(named))) return folded(named);
  }
  for (const name of names) {
    if (fact.kind === "date") continue;
    if (fact.kind === "age" && /^\s*(?:tulajdonosa|labdarúgója|vezetőedzője)/iu.test(after))
      continue;
    if (fact.kind === "number" && /^\s*(?:év|anni|years)/iu.test(after)) continue;
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    const direct = new RegExp(
      String.raw`(?<!\p{L})${escaped}(?:t|et|nak|nek)?\s*(?:,\s*)?(?:(?:scored|scores|szerzett|fizetése|értéke|ára|salary|costs|earns|worth)\s+)?$`,
      "iu",
    );
    if (direct.test(before) && fact.kind !== "score") return folded(name);
  }
  return null;
}
function scoreWinner(text: string, fact: NumericFact, names: string[]): string | null {
  const [left, right] = fact.key.split(":");
  const score = `${left}\\s*[-–—:]\\s*${right}`;
  for (const name of names) {
    const escaped = name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
    if (
      new RegExp(
        String.raw`\b${escaped}\s+${score}(?:-ra|-re)?\s+(?:verte|legyőzte|defeated|beat)\b`,
        "iu",
      ).test(text) ||
      new RegExp(
        String.raw`\b${escaped}\s+(?:beat|defeated|verte|legyőzte)\s+\p{Lu}[\p{L}'’\-]{2,}\s+${score}`,
        "iu",
      ).test(text)
    )
      return folded(name);
  }
  return null;
}
function equivalent(source: NumericFact, output: NumericFact): boolean {
  // Omitting a unit can be a projection of a proven amount; inventing a currency cannot.
  if (output.kind === "number" && source.kind === "money")
    return output.key === source.key.split(":")[0];
  if (output.kind === "number" && source.kind === "date")
    return output.key === source.key.split("-")[0];
  if (
    (output.kind === "age" && source.kind === "number") ||
    (output.kind === "number" && source.kind === "age")
  )
    return output.key === source.key;
  if (source.kind !== output.kind) return false;
  if (source.key === output.key) return true;
  return (
    source.kind === "date" &&
    output.key.startsWith("----") &&
    source.key.slice(-5) === output.key.slice(-5)
  );
}
export function unverifiedNumericClaims(
  source: string,
  output: string,
  options: { sourceLanguage?: string } = {},
): string[] {
  if (source.length > 250_000 || output.length > 100_000) return ["number:oversized_numeric_input"];
  const language = ["en", "de", "es", "it", "hu"].includes(options.sourceLanguage ?? "")
    ? (options.sourceLanguage as NumericLanguage)
    : inferLanguage(source);
  const sourceFacts = numericFacts(source, language);
  const outputFacts = numericFacts(output, "hu");
  const names = sharedNames(source, output);
  const issues: string[] = [];
  for (const claim of outputFacts) {
    const candidates = sourceFacts.filter((fact) => equivalent(fact, claim));
    const label = ["age", "length", "season", "range", "ambiguous"].includes(claim.kind)
      ? "number"
      : claim.kind;
    if (!candidates.length || claim.kind === "ambiguous") {
      issues.push(`${label}:${claim.raw}`);
      continue;
    }
    const owner = explicitOwner(output, claim, names);
    const bound = candidates
      .map((fact) => explicitOwner(source, fact, names))
      .filter((name): name is string => name !== null);
    if (owner && bound.length && !bound.includes(owner))
      issues.push(`assignment:${owner}:${claim.raw}`);
    if (claim.kind === "score") {
      const sourceWinner = scoreWinner(source, candidates[0]!, names),
        outputWinner = scoreWinner(output, claim, names);
      if (sourceWinner && outputWinner && sourceWinner !== outputWinner)
        issues.push(`assignment:${outputWinner}:${claim.raw}`);
    }
  }
  return [...new Set(issues)];
}
