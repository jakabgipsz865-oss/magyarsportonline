# ADR 0006 — MVP: fingerprint-alapú dedup embedding-keresés helyett

**Státusz:** elfogadva
**Dátum:** 2026-07-27
**Kontextus:** első működő end-to-end MVP

## Döntési helyzet

A jóváhagyott terv ([02-agents.md §2.2](../architecture/02-agents.md#22--deduplication-agent)) a Deduplication Agent elsődleges döntési mechanizmusaként **embedding-alapú szemantikai hasonlóságkeresést** ír elő (pgvector ANN-keresés), amit entitás-egyeztetés erősít meg. Az embedding-modell kiválasztása explicit, jövőbeli döntés — [ADR 0002](0002-embedding-vector-dimensions.md) már jelezte, hogy ez Fázis 4-re van ütemezve, és jelenleg **nincs beszerezve/konfigurálva embedding-szolgáltató API-kulcs** ebben a fejlesztési környezetben.

## Döntés

Az MVP Deduplication Agent **kizárólag a már Fázis 0-ban elkészült fingerprint-mechanizmust** használja (`computeFingerprint()` + `story_fingerprints` tábla, lásd [ADR-független, 01-data-model.md §1.5.1](../architecture/01-data-model.md#151-story_fingerprints--story-létrehozási-race-condition-elleni-védelem)): kategória + fő entitás + dátum-bucket alapú egyezés dönti el, hogy egy új `RawArticle` egy meglévő Story-hoz tartozik-e. **Nincs embedding-generálás, nincs vektorkeresés.**

## Indoklás

- A fingerprint-mechanizmus a race-condition védelemhez már úgyis elkészült és tesztelt (Fázis 0) — ugyanaz a durva, de determinisztikus "azonos esemény" jelzés, amit a dedup elsődleges jelzőjeként is fel lehet használni, embedding-szolgáltató nélkül.
- **Explicit, dokumentált korlátozás**, nem rejtett hiányosság: a fingerprint-only dedup **hamis pozitívot** adhat (pl. két különböző, azonos napi, azonos csapatot érintő, de eltérő témájú hír tévesen egy Story-ba kerülhet), mert nincs finomhangolt szemantikai megkülönböztetés. Ez elfogadható az MVP demonstrációs céljára (egy kontrollált, két-forrásos demo-eseménnyel), de **éles, sokforrásos üzemre nem elegendő** — ott kötelező az embedding-alapú finomítás (Fázis 4).
- **Legegyszerűbb, könnyen bővíthető megoldás**: a Deduplication Agent függvény interfésze (`RawArticle` be, `NEW_STORY | MATCH | AMBIGUOUS` ki) változatlan marad, amikor később embedding-alapú finomítás kerül bele — csak a döntési logika belseje bővül, a hívók (Story Merge Agent) nem változnak.

## Következmény

- Az MVP Deduplication Agent tesztjei csak a fingerprint-döntési logikát fedik le, embedding-hasonlósági eseteket nem.
- A `raw_articles.embedding` oszlop az MVP-ben `NULL` marad minden beszúrt sornál — ez megengedett (az oszlop nullable), és nem okoz hibát, de jelzi, hogy a szemantikai dedup-réteg még nincs bekötve.
- Amikor a Fázis 4 embedding-modellt választ, ez az ADR felülvizsgálandó, és a Deduplication Agent kiegészítendő a tervezett ANN-kereséssel.
