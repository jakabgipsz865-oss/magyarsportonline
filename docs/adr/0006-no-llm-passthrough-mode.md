# ADR 0006 — No-LLM passthrough mode fizetős API-keret nélküli üzemhez

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** valódi Neon PostgreSQL bekötés utáni első Vercel deployment, mielőtt bármilyen fizetős Anthropic/OpenAI API-keret rendelkezésre állna.

## Döntési helyzet

A projekt gazdája jelenleg nem rendelkezik önálló, a Vercelen futó szerverkód által hívható Anthropic- vagy OpenAI API-kerettel (a személyes Claude/ChatGPT előfizetés erre nem használható), és egyelőre nem szeretne új fizetős szolgáltatást bekötni. Ugyanakkor a teljes pipeline (RSS ingest → dedup → Story → Confidence Score → publikálás → Timeline) valós Neon adatbázison, valós deploymenten tesztelendő és bemutatható kell legyen — a Hungarian Writer/Fact Verification agentek LLM-hívása nélkül is.

## Döntés

1. **Új env-váltó: `LLM_PROVIDER` (`"none" | "anthropic"`), alapértelmezés `"none"`.** `apps/web/lib/env.ts`-ben `ANTHROPIC_API_KEY` emiatt opcionálissá vált — csak `LLM_PROVIDER=anthropic` esetén kötelező ténylegesen, amit `apps/web/lib/llm.ts` ellenőriz (kereszt-mező validáció, amit a `createEnv` séma önmagában nem fejez ki).
2. **Új `NoLlmClient` adapter** (`packages/llm/src/no-llm-client.ts`), ami ugyanazt a `LlmClient` interfészt implementálja, mint az `AnthropicLlmClient` — a Fact Verification és Hungarian Writer agent kód (`extraction.ts`, `generation.ts`, `self-check.ts`) **egyetlen sort sem** tud arról, melyik adapter válaszol. A `completeJson` hívás JSON-sémájának alakja alapján ismeri fel, melyik három ismert hívásról van szó, és:
   - extrakció: az eredeti cím + RSS-leírás nyers szövegét adja vissza egyetlen, `"other"` típusú tényként — fordítás/generálás nélkül;
   - szövegírás: ugyanezt a nyers szöveget adja vissza `title_hu`/`body_hu` gyanánt, a `lead_hu`-ba egy fix, egyértelmű magyar nyelvű figyelmeztetést téve ("még nem AI által lefordított tartalom");
   - önellenőrzés: mindig `consistent: true`-t ad vissza — szó szerinti átvétel nem hallucinálhat a saját forrásához képest.
3. **Új `is_ai_generated` boolean oszlop** a `story_versions` és a `story_read_model` táblán (default `true`, migráció: `0001_purple_wolfsbane.sql`). A Hungarian Writer agent ezt egyetlen, tisztán jelölő célú `deps.llm instanceof NoLlmClient` ellenőrzéssel állítja be — ez **nem** befolyásolja az agent tényleges logikáját/generálását, kizárólag a `generated_by_model` és `is_ai_generated` mezők értékét.
4. **Frontend jelölés:** a főoldal listaelemei és a `/hir/[slug]` oldal is egyértelmű, szövegesen kiírt jelzést mutat, ha `isAiGenerated === false` — sosem hagyatkozunk kizárólag arra, hogy a szöveg angol nyelvű (ami implicit, de nem elég egyértelmű jelzés).
5. **A pipeline többi része teljesen érintetlen.** RSS ingest, deduplikáció (fingerprint + alias-lookup), Risk Classifier, Confidence Score, Publish Gate — ezek eleve determinisztikusak, sosem hívtak LLM-et, így `LLM_PROVIDER` értékétől függetlenül azonosan működnek.

## Indoklás

- Az adapter-mintát (ADR 0005 1. pontja az event dispatcherre, itt ugyanaz az elv az LLM-rétegre) követi: a döntés a meglévő, szűk `LlmClient` interfész **egy új implementációja**, nem az agentek újratervezése — a valódi Anthropic-hívásra (vagy egy jövőbeli OpenAI-adapterre) váltás egyetlen env-változó módosítása, nem kód-migráció.
- A JSON-séma-alak alapú felismerés (nem pl. egy explicit "melyik hívás ez" paraméter az agentektől) tartja fenn azt, hogy a Fact Verification/Hungarian Writer kód 100%-ban adapter-agnosztikus maradjon — pontosan úgy olvassa a kérést, ahogy egy valódi LLM tenné.
- Az `is_ai_generated` mezőt a `generated_by_model` szöveges értékéből (`"no-llm-passthrough@1"` vs. a valódi modell-azonosító) való visszafejtés helyett külön boolean oszlopként vezettük be — explicit, migrálható, nem string-parse-ra épülő jelzés.

## Következmény

- Amíg `LLM_PROVIDER=none` az aktív mód, a publikált Story-k szövege **nem magyar nyelvű AI-összefoglaló**, hanem az eredeti forrás nyers szövege — ez szándékos, világosan jelölt átmeneti állapot, nem hiba.
- Egy jövőbeli OpenAI-adapter bevezetése ugyanezt a mintát követi: új `OpenAiLlmClient` a `packages/llm`-ben, egy új `LLM_PROVIDER` enum-érték, egy ág `apps/web/lib/llm.ts`-ben — az agentek és ez az ADR által bevezetett `is_ai_generated`/jelölési mechanizmus változatlan marad.
