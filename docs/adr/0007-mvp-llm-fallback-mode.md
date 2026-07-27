# ADR 0007 — LLM fallback mód `ANTHROPIC_API_KEY` hiányában

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** első működő end-to-end MVP

## Döntési helyzet

A Fact Verification Agent és a Hungarian Writer Agent ([02-agents.md §2.4, §2.5](../architecture/02-agents.md)) LLM-hívásokra épül (strukturált tény-extrakció, majd magyar nyelvű, eredeti megfogalmazású generálás). Ebben a fejlesztési környezetben **nincs beszerezve `ANTHROPIC_API_KEY`** — valódi Anthropic API-hívás emiatt jelenleg nem végezhető el.

A `docs/architecture` implementáció során kapott korábbi, továbbra is érvényes irányelv szerint **tilos működésképtelen vagy félrevezető placeholder implementációt** használni — vagyis nem lehet úgy tenni, mintha a rendszer valódi AI-t hívna, ha valójában nem azt teszi.

## Döntés

A `packages/llm` csomag egy valódi, működő Anthropic SDK-wrappert ad (`createAnthropicClient()`), amit **`ANTHROPIC_API_KEY` megléte esetén** a Fact Verification és a Hungarian Writer Agent ténylegesen használ.

**`ANTHROPIC_API_KEY` hiányában** mindkét agent egy explicit, **külön kódútként megjelölt fallback módra** vált:

- Fact Verification fallback: szabályalapú (regex) extraktor, ami csak korlátozott ténytípusokat (végeredmény, esemény időpontja) ismer fel — **nem LLM**, ezt a `Fact.payload` és a strukturált log is jelzi (`extraction_method: "rule_based_fallback"`).
- Hungarian Writer fallback: **determinisztikus sablon-renderelő**, ami a kinyert `Fact`-készletből mondatsablonokkal állít elő magyar szöveget — **nem AI-generált**. A `StoryVersion.generatedByModel` mező ilyenkor `"template-fallback-v1"` értéket kap (soha nem hamisít valódi modellnevet), és a Story-oldalon a frontend ezt láthatóan jelzi.

## Indoklás

- Ez az **egyetlen módja** annak, hogy a teljes pipeline (RSS → Story → mentés → megjelenítés → frissítés) API-kulcs nélkül is bemutatható és tesztelhető legyen ebben a fejlesztői környezetben, **anélkül hogy bármit hamisítanánk**: az adatmodell maga (`generatedByModel`) őszintén rögzíti, hogy nem AI írta a szöveget.
- **Production-ben ez a mód sosem aktiválódik szándékosan** — `ANTHROPIC_API_KEY` hiánya production/staging környezetben a Fázis 13 (Production Hardening) checklist szerint amúgy is blokkoló hiba lenne; a fallback kizárólag lokális fejlesztés/demo/CI célra létezik.
- **Legegyszerűbb, visszafordítható megoldás**: a fallback nem külön architektúra, csak egy `if (isLlmConfigured()) { ... } else { ... }` elágazás minden érintett agentben — a valódi LLM-útvonal a fő, tesztelt kódút, a fallback csak annak minimál-funkciós helyettesítője.

## Következmény

- A demo/CI-ben generált `StoryVersion`-ök `generatedByModel="template-fallback-v1"` értékkel jönnek létre, hacsak valaki explicit nem állítja be az `ANTHROPIC_API_KEY`-t — ez utóbbi esetben a pipeline változtatás nélkül valódi Claude-hívásokkal fut.
- A self-check (NLI-szerű konzisztencia-ellenőrzés, [02-agents.md §2.5](../architecture/02-agents.md#25--hungarian-writer-agent)) csak a valódi LLM-útvonalon fut (egy második, olcsó modellhívásként) — fallback módban nincs mit ellenőrizni (a sablon-szöveg definíció szerint csak a `Fact`-készletből származó, verbatim adatokat tartalmaz), a `factConsistencyScore` ilyenkor `1.0`.
- A prompt injection elleni védelem ([02-agents.md §2.4](../architecture/02-agents.md#24--fact-verification-agent)) csak a valódi LLM-útvonalon releváns (a fallback regex-extraktor nem küld semmit LLM-nek); a fallback módban egy egyszerűbb, szintaktikai heurisztika fut (gyanús minták keresése a nyers szövegben) ugyanazzal a `promptInjectionSuspected` kimenettel, hogy a downstream logika (risk gate) ne kelljen elágaznia a két mód között.
