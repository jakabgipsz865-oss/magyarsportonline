import { numericFacts } from "./tabloid-numbers";
const articles = new Set(
  "a az egy the der die das ein eine il lo la el los las un una és and und e y hogy is he she it we they ő én mi ők on in at to of for mit von zu im am di del della al da en con por egyet egyik valamely".split(
    " ",
  ),
);
const aliases: Record<string, string> = {
  won: "WIN",
  win: "WIN",
  wins: "WIN",
  beat: "WIN",
  defeated: "WIN",
  gewann: "WIN",
  gewonnen: "WIN",
  siegte: "WIN",
  gano: "WIN",
  vinse: "WIN",
  vinto: "WIN",
  vittoria: "WIN",
  match: "MATCH",
  game: "MATCH",
  spiel: "MATCH",
  partita: "MATCH",
  partido: "MATCH",
  against: "AGAINST",
  gegen: "AGAINST",
  contro: "AGAINST",
  ellen: "AGAINST",
  not: "NOT",
  non: "NOT",
  no: "NOT",
  kein: "NOT",
  nem: "NOT",
  could: "MAY",
  might: "MAY",
  may: "MAY",
  kann: "MAY",
  lehet: "MAY",
  reported: "REPORT",
  said: "SAY",
  sagte: "SAY",
  disse: "SAY",
};
function fold(s: string) {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}
function canonical(word: string): string {
  const v = fold(word);
  if (aliases[v]) return aliases[v]!;
  if (
    /^(?:gyoz|nyer|megnyer|legyoz)(?:ott|ott[e]?|tek|te|t|elmet|elem|tes|nie|ni|ett|es|elme|elmet)?$/u.test(
      v,
    )
  )
    return "WIN";
  if (/^(?:merkozes|meccs)(?:t|et|en|ben|re|rol)?$/u.test(v)) return "MATCH";
  if (/^mond(?:ta|ott|tak)$/u.test(v)) return "SAY";
  if (/^szerint$/u.test(v)) return "REPORT";
  return v;
}
function tokens(s: string): string[] {
  return s.match(/\p{L}+(?:['’-]\p{L}+)*/gu) ?? [];
}
function content(s: string): string[] {
  const prepared = s.replace(/győzelmet\s+(?:hozott|szerzett|aratott)/giu, "győzött");
  return [
    ...new Set(
      tokens(prepared)
        .filter((w) => !articles.has(fold(w)))
        .map(canonical),
    ),
  ].sort();
}
function names(s: string): string[] {
  return tokens(s).filter(
    (w) => /^\p{Lu}/u.test(w) && !articles.has(fold(w)) && canonical(w) === fold(w),
  );
}
function quotes(s: string): string[] {
  return s.match(/"[^"\n]*"|„[^”\n]*”|“[^”\n]*”|«[^»\n]*»/gu) ?? [];
}
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
/** Conservative local equivalence, not an AI assertion of semantic safety.
 * Unsupported paraphrases fail closed; this deliberately limits automatic repair.
 */
export function preservationFailure(
  before: string,
  after: string,
  strictContent = false,
): string | null {
  const signature = (s: string) =>
    numericFacts(s, "hu")
      .map((f) => `${f.kind}:${f.key}`)
      .sort();
  if (
    !same(signature(before), signature(after)) ||
    !same(before.match(/\d+(?:[.,:/–-]\d+)*/gu) ?? [], after.match(/\d+(?:[.,:/–-]\d+)*/gu) ?? [])
  )
    return "numbers_changed";
  if (!same(quotes(before), quotes(after))) return "quote_changed";
  if (!same(names(before), names(after))) return "proper_names_changed";
  if (strictContent && !same(content(before), content(after))) return "unproven_semantic_change";
  return null;
}
