# 08 — 100 lépéses fejlesztési roadmap

[← vissza az áttekintéshez](./README.md)

A roadmap 12 fázisra tagolódik. Minden fázis egy-egy működő, tesztelhető állapotot ér el — a csapat bármelyik fázis végén megállhat és élesben futtathatja az addig elkészült funkciókat (fokozatos, nem "big bang" bevezetés, összhangban a [feasibility-analysis.md](../feasibility-analysis.md) javasolt ütemtervével).

## Fázis 0 — Projekt alapok (1–8)

1. Monorepo inicializálása (pnpm + Turborepo), `apps/web` Next.js (App Router, TypeScript) alap projekt létrehozása.
2. `packages/shared`, `packages/config` (eslint/tsconfig/prettier presetek) létrehozása.
3. CI pipeline felállítása GitHub Actions-ben: lint + typecheck minden PR-en.
4. Neon projekt létrehozása, dev + preview branch-elési stratégia beállítása.
5. Vercel projekt összekötése a GitHub repóval, alap deployment ellenőrzése ("Hello World" oldal él).
6. Environment variable struktúra kialakítása (`.env.example`), titkok Vercel dashboardba feltöltve környezetenként.
7. Alap `docs/` struktúra és `CONTRIBUTING.md` (fejlesztői workflow leírása) létrehozása.
8. Impresszum, felelős szerkesztő adatlap statikus oldal létrehozása (jogi kötelezettség, lásd [feasibility-analysis.md §9](../feasibility-analysis.md)).

## Fázis 1 — Adatbázis & domain modell (9–20)

9. Drizzle ORM beállítása, kapcsolat Neon-hoz.
10. `sources` tábla séma + migráció.
11. `raw_articles` tábla séma + migráció, pgvector extension engedélyezése.
12. `stories` tábla séma + migráció (állapotgép mezőkkel).
13. `story_versions` tábla séma + migráció.
14. `story_sources` tábla séma + migráció (join, contribution_type enum).
15. `entities`, `story_entities` táblák séma + migráció.
16. `categories`, `tags`, `story_tags` táblák séma + migráció, kezdeti taxonómia seed (sportágak, ligák).
17. `facts` tábla séma + migráció.
18. `review_queue_items`, `social_posts`, `agent_runs` táblák séma + migráció.
19. `packages/db/src/repositories` — alap repository réteg (StoryRepository, SourceRepository, RawArticleRepository) egységteszttel.
20. Adatbázis seed-script teszt-forrásokkal és mintaadatokkal a lokális fejlesztéshez.

## Fázis 2 — Event/queue infrastruktúra (21–28)

21. Inngest projekt létrehozása, `packages/events` csomag alapjai (esemény-típusdefiníciók Zod-dal).
22. `/api/inngest` catch-all route létrehozása Next.js-ben, Inngest kliens bekötése.
23. Esemény-katalógus implementálása kódban ([03-event-flow.md §3.2](./03-event-flow.md#32-esemény-katalógus) alapján), verziózott séma.
24. Idempotencia-védelem: unique constraint-ek bevezetése kritikus join-táblákon.
25. Correlation ID generálás és végigvitel az eseményláncon.
26. Concurrency-limit konfiguráció Story-szinten (Inngest `concurrency` config).
27. Dead-letter kezelés és alap retry-policy beállítása minden agent-functionre.
28. Lokális Inngest Dev Server integrálása a fejlesztői workflow-ba, dokumentálva.

## Fázis 3 — Source Ingest Agent (29–36)

29. `packages/agents/source-ingest` csomag váza, `AGENT_VERSION` konvenció bevezetése.
30. RSS-fetcher implementálása (parse, tisztítás, normalizálás).
31. API-alapú fetcher implementálása (strukturált forrásokhoz).
32. Első valós, licencelt/engedélyezett angol nyelvű forrás bekötése és jogi ellenőrzése (egyszeri, emberi feladat).
33. URL-alapú dedup és `RawArticle` insert logika.
34. Cron-dispatch endpoint (`/api/internal/cron/dispatch-ingest`) implementálása forrás-tier alapú ütemezéssel.
35. Hibakezelés: retry backoff, forrás-elérhetetlenség detektálása, `Source.is_active` javaslat logika.
36. End-to-end teszt: 1 forrásból tényleges `RawArticle` bekerül az adatbázisba, esemény kimegy a queue-ra.

## Fázis 4 — Deduplication Agent (37–44)

37. `packages/agents/deduplication` csomag váza.
38. Embedding-generálás integrálása (cím+lead → vektor).
39. pgvector ANN-index létrehozása és keresési lekérdezés implementálása.
40. Entitás-kinyerő (NER) komponens implementálása (csapat/játékos/dátum).
41. Kereszt-validációs döntési logika (`NEW_STORY`/`MATCH`/`AMBIGUOUS`) implementálása.
42. Küszöbértékek konfigurálhatóvá tétele (config tábla vagy env), kezdeti kalibráció teszt-adatokon.
43. `story/candidate.identified` esemény kibocsátás implementálása.
44. Unit + integrációs tesztek: ismert duplikált párok és egyértelműen különböző hírek helyes osztályozása.

## Fázis 5 — Story Merge Agent (45–50)

45. `packages/agents/story-merge` csomag váza.
46. Új Story létrehozási logika (`NEW_STORY` ág).
47. Meglévő Story-hoz csatolás logika (`MATCH` ág), `StorySource` insert.
48. Gyors tény-diff implementálása (`corroboration` vs. `new_info` megkülönböztetés).
49. `story/created` és `story/merge.completed` események kibocsátása.
50. Tesztek: ugyanazon esemény 3 forrásból helyesen 1 Story-vá áll össze, `confidence` alap-inkrementálás működik.

## Fázis 6 — Fact Verification Agent (51–58)

51. `packages/agents/fact-verification` csomag váza, LLM-kliens (`packages/llm`) integrálása.
52. Structured-output extrakciós prompt kialakítása és tesztelése (ki/mit/mikor/hol/eredmény/idézet séma).
53. `facts` táblába írás, forrásonkénti tény-rekordok.
54. Kereszt-ellenőrzési logika (azonos `fact_type` egyezés/ellentmondás észlelése).
55. Confidence Score számítási modul implementálása ([01-data-model.md §1.4](./01-data-model.md#14--confidence-score--számítási-modell) képlet alapján).
56. Risk-osztályozó implementálása: szabályalapú kulcsszó/entitás-szűrő réteg.
57. Risk-osztályozó LLM-alapú finomító rétege a határesetekhez.
58. `story/facts.verified` esemény + teljes agent tesztkészlet (kontradikciós és tiszta esetek).

## Fázis 7 — Hungarian Writer Agent (59–66)

59. `packages/agents/hungarian-writer` csomag váza, prompt-sablon verziózási konvenció (`prompts/v1/...`).
60. Generálási prompt kialakítása: kizárólag `Fact`-készletre épülő, magyar nyelvű cím/lead/törzs generálás.
61. Idézet-kezelési szabály implementálása (csak `fact_type='quote'` alapján, forrás-hivatkozással).
62. `change_summary_hu` generálási logika frissítéseknél (diff az előző verzióhoz képest).
63. Önellenőrző (NLI/entailment) lépés implementálása, elutasítás/retry logika.
64. `fact_consistency_score` számítás és mentés `StoryVersion`-re.
65. `story/content.drafted` esemény kibocsátása.
66. Minőségi tesztkészlet: hallucináció-ellenőrző tesztesetek (szándékosan hiányos `Fact`-készlettel), stílus-konzisztencia manuális review-val.

## Fázis 8 — SEO Agent (67–72)

67. `packages/agents/seo` csomag váza.
68. Slug-generálási logika (ékezet-eltávolítás, ütközés-ellenőrzés, `UNIQUE` retry), csak első verziónál.
69. Meta description generálási prompt (karakterlimit-validációval).
70. Entitás-alapú tag/kategória hozzárendelés előre definiált taxonómiából.
71. `schema.org NewsArticle`/`SportsEvent` JSON-LD generálás.
72. `story/seo.ready` esemény + tesztek (slug-stabilitás frissítéseken át).

## Fázis 9 — Publish Gate & publikus frontend (73–82)

73. `packages/agents/publish-gate` — determinisztikus szabálymotor implementálása (küszöbérték-config).
74. `review_queue_items` insert logika magas kockázat/alacsony confidence esetén.
75. `story/published` és `story/review.requested` események.
76. Publikus `/api/v1/stories`, `/api/v1/stories/{slug}` végpontok implementálása ([04-api-spec.md §4.1](./04-api-spec.md#41--publikus-api--apiv1)).
77. Next.js publikus Story-oldal (`/hir/[slug]`) — ISR-jel, on-demand revalidate `story/published` eseményre.
78. Kategória- és entitás-oldalak (`/kategoria/[slug]`, `/csapat/[slug]`).
79. Verziótörténet / "Frissítések" UI-komponens a Story-oldalon.
80. Sitemap és RSS feed generálás.
81. Alap SEO-technikai audit (Core Web Vitals, strukturált adat validálás).
82. **Soft launch**: Publish Gate `FORCE_REVIEW_MODE=true` — minden cikk emberi jóváhagyással megy ki 1-2 hétig, hibaarány mérése (lásd [feasibility-analysis.md §5](../feasibility-analysis.md)).

## Fázis 10 — Admin Review UI & Monitoring & Audit Agent (83–90)

83. NextAuth admin authentikáció bevezetése, `editor`/`admin` szerepkörök.
84. Admin Review UI: review-queue lista + részletnézet (`Fact`-ek, kontradikciók, confidence-bontás megjelenítése).
85. Jóváhagyás/elutasítás/szerkesztés admin akciók implementálása ([04-api-spec.md §4.2](./04-api-spec.md#42--admin-api--apiadmin)).
86. Retrakciós folyamat implementálása (`/api/admin/stories/{id}/retract`).
87. `packages/agents/monitoring-audit` — minden eseményre feliratkozó audit-logoló implementálása.
88. Anomália-detekciós szabályok (elhalt forrás, dedup false-positive spike, review-queue torlódás, LLM-hiba arány).
89. Slack/e-mail riasztási integráció, napi összegző jelentés.
90. Kill-switch mechanizmus implementálása és admin UI-ból elérhetővé tétele.

## Fázis 11 — Automatizáció bővítése, Social Media Agent (91–96)

91. Mért hibaarány alapján Publish Gate küszöbök lazítása: alacsony kockázatú kategóriák auto-publish-re kapcsolása ([feasibility-analysis.md §5](../feasibility-analysis.md) fokozatos bevezetési elve).
92. `packages/agents/social-media` váza, Meta App Review folyamat elindítása (Facebook/Threads).
93. X API integráció és kvóta-tervezés.
94. Platform-specifikus szöveggenerálási promptok, kép/kártya generálás.
95. `social_posts` mentés, retrakció-kezelés közösségi posztokon.
96. Social Media Agent bekapcsolása kizárólag már publikált Story-khoz, throttling/rate-limit teszteléssel.

## Fázis 12 — Skálázás, hardening, teljes automatizáció (97–100)

97. Modell-tiering bevezetése (`packages/llm/model-router.ts`) a költségoptimalizált agent-lánchoz ([07-scalability.md §7.3](./07-scalability.md#73-llm-költség-kontroll--modell-tiering)).
98. Forrás-onboarding fél-automatizált folyamat kialakítása (robots.txt/ToS-elemző agent + emberi jóváhagyási lépés), forrásbázis bővítése tucatnyi, majd száz+ forrásra.
99. Terheléspróba és DB/queue skálázási beavatkozások elvégzése a mért adatok alapján ([07-scalability.md §7.4–7.6](./07-scalability.md#74-adatbázis-skálázás)).
100. Teljes rendszer end-to-end audit: jogi megfelelés (impresszum, forrásmegjelölés, AI-tartalom jelölés), biztonsági review, költség-riport, és a **kill-switch + review-gate mechanizmusok éles teszt-forgatókönyve** — ezt követően a rendszer "AI-first, kivétel-alapú emberi felügyelettel működő" éles üzemmódba kerül.

---

## Roadmap-elvek összefoglalása

- **Minden fázis végén futóképes, deploy-olható állapot van** — nincs "big bang" integráció a végén.
- **A Publish Gate küszöbértékei tudatosan szigorúan indulnak** (Fázis 9: minden cikk review-ban) és **csak mért adatok alapján lazulnak** (Fázis 11) — ez az egyetlen hely a roadmap-ben, ahol az "emberi beavatkozás mennyisége" explicit, tudatos döntés tárgya, nem alapértelmezés.
- **A Social Media Agent tudatosan a legvégén kapcsolódik be** (Fázis 11), miután a weboldali publikálás már bizonyítottan stabil — összhangban a [feasibility-analysis.md §8](../feasibility-analysis.md) javaslatával.
- **A forrásbázis bővítése (1 → 300+) explicit, külön lépés** (98-99), nem implicit mellékhatás — mert minden új forrás jogi és minőségi kockázatot hoz be, amit tudatosan kell kezelni.
