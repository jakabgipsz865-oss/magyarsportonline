# 08 — Fejlesztési roadmap

[← vissza az áttekintéshez](./README.md)

A roadmap eredetileg 100, a [09-architecture-review.md](./09-architecture-review.md) kritikai review nyomán 16 további lépéssel (Fázis 13) kiegészítve **116 lépésre** bővült, 13 fázisra tagolva. Minden fázis egy-egy működő, tesztelhető állapotot ér el — a csapat bármelyik fázis végén megállhat és élesben futtathatja az addig elkészült funkciókat (fokozatos, nem "big bang" bevezetés, összhangban a [feasibility-analysis.md](../feasibility-analysis.md) javasolt ütemtervével).

> **Fontos sorrendi megkötés (review-kapu):** a [09-architecture-review.md](./09-architecture-review.md) 🔴 (kritikus) megállapításai közül négy — a Story-létrehozási race condition védelme, az `agent_runs`/observability-log szétválasztása, a `story_read_model` CQRS-projekció, és a fingerprint-tábla — **az adatmodell és az event-kontraktus szintjén dőlnek el**, ezért ezeket **már a Fázis 1-2-ben be kell építeni** (lásd a 13., 19a. és 27a. lépéseket lent), nem utólagos migrációként. A többi 🔴/🟡 tétel (biztonsági, observability, DR) a Fázis 13-ban, az éles indulás előtti kötelező kapuként szerepel.

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

    **13a. (review-kiegészítés) `story_fingerprints` tábla séma + migráció** — a Story-létrehozási race condition elleni advisory-lock mechanizmushoz ([01-data-model.md §1.5.1](./01-data-model.md#151-story_fingerprints--story-létrehozási-race-condition-elleni-védelem), [03-event-flow.md §3.7](./03-event-flow.md#37-story-létrehozási-race-condition--javítás-09-architecture-reviewmd-9-alapján)). **Ezt már itt, a Story Merge Agent implementálása előtt (Fázis 5) kötelező elkészíteni**, nem utólag — mert a Story-létrehozási logika a tábla nélkül eleve hibásan íródna meg.

15. `entities`, `story_entities` táblák séma + migráció.
16. `categories`, `tags`, `story_tags` táblák séma + migráció, kezdeti taxonómia seed (sportágak, ligák).
17. `facts` tábla séma + migráció.
18. `review_queue_items`, `social_posts`, `agent_runs` (**csak vékony, összegzett formában** — lásd review-kiegészítés lent) táblák séma + migráció.

    **19a. (review-kiegészítés) `story_read_model` tábla/materialized view séma + migráció** — a CQRS olvasási projekcióhoz ([01-data-model.md §1.5.2](./01-data-model.md#152-story_read_model--cqrs-olvasási-projekció)). Már itt tervezni kell, mert a publikus API (Fázis 9) ezt fogja olvasni a write-oldali táblák helyett.

19. `packages/db/src/repositories` — alap repository réteg (StoryRepository, SourceRepository, RawArticleRepository) egységteszttel, **agentenként szűkített interfésszel** (review-kiegészítés: minden agent csak a saját bounded context-jéhez tartozó repository-metódusokat lássa, ne a teljes séma-hozzáférést — [09-architecture-review.md §4](./09-architecture-review.md#4-laza-csatolás--hol-volt-túl-szoros)).
20. Adatbázis seed-script teszt-forrásokkal és mintaadatokkal a lokális fejlesztéshez.

## Fázis 2 — Event/queue infrastruktúra (21–28)

21. Inngest projekt létrehozása, `packages/events` csomag alapjai (esemény-típusdefiníciók Zod-dal).
22. `/api/inngest` catch-all route létrehozása Next.js-ben, Inngest kliens bekötése.
23. Esemény-katalógus implementálása kódban ([03-event-flow.md §3.2](./03-event-flow.md#32-esemény-katalógus) alapján), verziózott séma.
24. Idempotencia-védelem: unique constraint-ek bevezetése kritikus join-táblákon **+ `pg_advisory_xact_lock`-alapú szerializáció a fingerprint-ütközésekre és `SELECT ... FOR UPDATE`/szekvencia a verziószámozásra** (review-kiegészítés, [09-architecture-review.md §9](./09-architecture-review.md#9-race-condition-locking-idempotencia)) — ez a mechanizmus a Story Merge Agent (Fázis 5) alapfeltétele, itt kell megírni és egységtesztelni, konkurens írásokat szimuláló teszttel.
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
46. Új Story létrehozási logika (`NEW_STORY` ág) **a 24. lépésben megírt fingerprint advisory-lock mechanizmuson keresztül** — konkurens teszt: két egyidejű, azonos eseményről szóló `NEW_STORY` jelölt sose hozzon létre két Story-t.
47. Meglévő Story-hoz csatolás logika (`MATCH` ág), `StorySource` insert.
48. Gyors tény-diff implementálása (`corroboration` vs. `new_info` megkülönböztetés).
49. `story/created` és `story/merge.completed` események kibocsátása.
50. Tesztek: ugyanazon esemény 3 forrásból helyesen 1 Story-vá áll össze, `confidence` alap-inkrementálás működik.

## Fázis 6 — Fact Verification Agent (51–58)

51. `packages/agents/fact-verification` csomag váza, LLM-kliens (`packages/llm`) integrálása.
52. Structured-output extrakciós prompt kialakítása és tesztelése (ki/mit/mikor/hol/eredmény/idézet séma) **statikus/dinamikus prompt-részek szétválasztásával a prompt-caching előkészítéséhez** (review-kiegészítés, [09-architecture-review.md §7](./09-architecture-review.md#7-llm-költség-minimalizálás)).
52a. (review-kiegészítés) **Extrakció-limitálás implementálása**: teljes extrakció csak Story-nkénti első 3-5 független forrásra, azon túl olcsó fingerprint-alapú megerősítés ([02-agents.md §2.4](./02-agents.md#24--fact-verification-agent)) — ez a legnagyobb önálló LLM-költségcsökkentő beavatkozás, itt kell megírni, nem utólagos optimalizálásként.
52b. (review-kiegészítés) **Prompt injection gyanú-jelző** implementálása a risk-osztályozóban ([02-agents.md §2.4](./02-agents.md#24--fact-verification-agent)) — teszteset: szándékosan preparált, utasítás-mintázatot tartalmazó forrásszöveg helyes `risk_level=high` besorolást kapjon.
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
63a. (review-kiegészítés) **Debounce/batch-elés implementálása** élő (`is_developing=true`) Story-khoz — 60-120 mp-es összegyűjtési ablak a Writer-hívás előtt ([02-agents.md §2.5](./02-agents.md#25--hungarian-writer-agent)), teszteset: több gyors egymás utáni `new_info` esemény egyetlen Writer-futást váltson ki.
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
76. Publikus `/api/v1/stories`, `/api/v1/stories/{slug}` végpontok implementálása ([04-api-spec.md §4.1](./04-api-spec.md#41--publikus-api--apiv1)), **kizárólag a `story_read_model` projekcióból olvasva** (review-kiegészítés, [01-data-model.md §1.5.2](./01-data-model.md#152-story_read_model--cqrs-olvasási-projekció)) + a projektort megvalósító event-consumer implementálása, amely `story/published`/`story/updated.published` eseményekre frissíti a projekciót.
76a. (review-kiegészítés) **Rate limiting bevezetése** a `/api/v1/*` végpontokon (Vercel Edge Middleware + Upstash Ratelimit, [04-api-spec.md](./04-api-spec.md)).
77. Next.js publikus Story-oldal (`/hir/[slug]`) — ISR-jel, on-demand revalidate `story/published` eseményre.
78. Kategória- és entitás-oldalak (`/kategoria/[slug]`, `/csapat/[slug]`).
79. Verziótörténet / "Frissítések" UI-komponens a Story-oldalon.
80. Sitemap és RSS feed generálás.
81. Alap SEO-technikai audit (Core Web Vitals, strukturált adat validálás).
82. **Soft launch**: Publish Gate `FORCE_REVIEW_MODE=true` — minden cikk emberi jóváhagyással megy ki 1-2 hétig, hibaarány mérése (lásd [feasibility-analysis.md §5](../feasibility-analysis.md)).

## Fázis 10 — Admin Review UI & Monitoring & Audit Agent (83–90)

83. NextAuth admin authentikáció bevezetése, `editor`/`admin` szerepkörök, **kötelező MFA** (review-kiegészítés, [09-architecture-review.md §8](./09-architecture-review.md#8-biztonsági-kockázatok)).
84. Admin Review UI: review-queue lista + részletnézet (`Fact`-ek, kontradikciók, confidence-bontás megjelenítése).
85. Jóváhagyás/elutasítás/szerkesztés admin akciók implementálása ([04-api-spec.md §4.2](./04-api-spec.md#42--admin-api--apiadmin)).
86. Retrakciós folyamat implementálása (`/api/admin/stories/{id}/retract`).
87. `packages/agents/monitoring-audit` — minden eseményre feliratkozó audit-logoló implementálása.
88. Anomália-detekciós szabályok (elhalt forrás, dedup false-positive spike, review-queue torlódás, LLM-hiba arány).
89. Slack/e-mail riasztási integráció, napi összegző jelentés.
90. Kill-switch mechanizmus implementálása és admin UI-ból elérhetővé tétele **+ automatikus cost circuit breaker** (napi LLM-költség küszöb feletti automatikus aktiválás, review-kiegészítés, [02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent)).
90a. (review-kiegészítés) **Post-publish sampling QA** implementálása — auto-publikált Story-k mintavételezett, aszinkron másodlagos LLM-ellenőrzése a Publish Gate döntéseinek visszamenőleges validálására ([02-agents.md §2.9](./02-agents.md#29--monitoring--audit-agent)).

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

## Fázis 13 — Production Hardening a review alapján (101–116)

*(A [09-architecture-review.md](./09-architecture-review.md) fennmaradó, a fentiekbe pontszerűen már beépített tételeken túli, rendszerszintű megállapításai — ez a fázis az éles, felügyelet-minimalizált üzem előtti **kötelező kapu**. Amíg ez a fázis nincs lezárva, a Publish Gate küszöbei nem lazíthatók a Fázis 11-ben leírtak szerint.)*

101. `packages/entity-resolution` közös csomag kiemelése — a Deduplication Agent és a Fact Verification Agent jelenleg duplikált entitás-kinyerő logikáját egy közös, önállóan tesztelt modulba szervezve (review-kiegészítés, [09-architecture-review.md §4](./09-architecture-review.md#4-laza-csatolás--hol-volt-túl-szoros)).
102. OpenTelemetry integráció bevezetése minden agentbe, `correlation_id`/`trace_id` végigvitele LLM-hívásokon és DB-műveleteken ([03-event-flow.md §3.8](./03-event-flow.md#38-tracing-és-observability-review-kiegészítés)).
103. Strukturált log-export bekötése dedikált observability-rendszerbe (Axiom/Better Stack/Datadog), `agent_runs` Postgres-tábla átalakítása vékony összegzővé ([06-deployment.md §6.8](./06-deployment.md#68-observability-stack-review-kiegészítés)).
104. Grafana (vagy ekvivalens) dashboard felállítása a kulcsmetrikákra (ingest lag, pipeline-latencia, auto-publish/review arány, LLM-költség/Story, confidence-eloszlás, kontradikció-arány, review-queue kora, forrás-egészség, API p95/p99, DB pool telítettség, queue backlog).
105. Explicit SLO-k rögzítése és SLO-sértésre riasztó szabályok bevezetése (nem csak nyers hibaarányra).
106. Synthetic monitoring ("kanári forrás") implementálása — ütemezett, végponttól-végpontig teszt a teljes pipeline-on, kifejezetten a `dispatch-ingest` néma leállásának kiszűrésére.
107. `raw_articles`, `facts`, `agent_runs` táblák havi particionálásának bevezetése, valamint a 12 hónapnál régebbi `raw_articles`/lezárt Story `facts` hideg tárolóba (Blob/S3) archiválása ([07-scalability.md §7.7](./07-scalability.md#77-konkrét-archiválási-szabályok-táblánként-review-kiegészítés)).
108. PITR bekapcsolása a production adatbázison, RPO ≤ 5 perc / RTO ≤ 1 óra célértékkel ([06-deployment.md §6.9](./06-deployment.md#69-backup-és-disaster-recovery-review-kiegészítés)).
109. Első helyreállítási próba végrehajtása tesztkörnyezetben (tényleges restore, nem csak dokumentáció), és negyedéves ismétlési folyamat beütemezése.
110. Konfiguráció/secrets helyreállítási folyamat dokumentálása és egyszeri gyakorlati tesztje (Vercel env, Inngest signing key, API-kulcsok újralétrehozása egy üres környezetben).
111. "Staleness" jelző bevezetése élő (`is_developing=true`) Story-khoz — LLM-kiesés vagy késés esetén automatikus `pending_review` átirányítás publikálás helyett ([06-deployment.md §6.10](./06-deployment.md#610-247-stabilitás--staleness-kezelés-review-kiegészítés)).
112. On-call/eszkalációs terv dokumentálása és első gyakorlati tesztje (P1/P2/P3 súlyossági szintek, felelős szerkesztő mint elsődleges címzett).
113. Deploy-folyamat kiegészítése: kötelező canary/staged rollout + `/api/inngest` smoke-test minden deploy után + dokumentált, begyakorolt rollback-folyamat ([06-deployment.md §6.7](./06-deployment.md#67-deployment-felület-izolációja-review-kiegészítés)).
114. Biztonsági audit: prompt injection tesztkészlet bővítése valós támadási mintákkal, publikus API rate-limit terheléses tesztje, admin MFA-folyamat penetrációs ellenőrzése.
115. Teljes rendszerszintű terheléspróba szimulált 10 000 Story/nap csúcsforgalommal, a §1/§2 review-megállapítások (dedup ANN-előszűrés, extrakció-limit, debounce, CQRS read-model) tényleges hatásának mérése éles-közeli körülmények között.
116. **Végső production-readiness checkpoint**: a [09-architecture-review.md §13](./09-architecture-review.md#13-összesített-változás-térkép) összes 🔴 tételének ellenőrzött lezárása, dokumentált eredménnyel — csak ez után lazíthatók a Publish Gate küszöbei a Fázis 11 szerint, és csak ez után indulhat a forrásbázis 100+ forrásra bővítése (Fázis 12, 98-99. lépés).

---

## Roadmap-elvek összefoglalása

- **Minden fázis végén futóképes, deploy-olható állapot van** — nincs "big bang" integráció a végén.
- **A Publish Gate küszöbértékei tudatosan szigorúan indulnak** (Fázis 9: minden cikk review-ban) és **csak mért adatok alapján lazulnak** (Fázis 11) — ez az egyetlen hely a roadmap-ben, ahol az "emberi beavatkozás mennyisége" explicit, tudatos döntés tárgya, nem alapértelmezés.
- **A Social Media Agent tudatosan a legvégén kapcsolódik be** (Fázis 11), miután a weboldali publikálás már bizonyítottan stabil — összhangban a [feasibility-analysis.md §8](../feasibility-analysis.md) javaslatával.
- **A forrásbázis bővítése (1 → 300+) explicit, külön lépés** (98-99), nem implicit mellékhatás — mert minden új forrás jogi és minőségi kockázatot hoz be, amit tudatosan kell kezelni.
- **A race condition-, CQRS- és observability-alapú javítások (13a, 19a, 24, 46) korán, az adatmodell/event-kontraktus szintjén épülnek be** — ezek utólagos migrációként való bevezetése lényegesen drágább lenne, mint a kezdetektől helyesen megtervezni.
- **Fázis 13 kötelező kapu az éles, felügyelet-minimalizált üzem előtt** — a [09-architecture-review.md](./09-architecture-review.md) kritikus (🔴) megállapításai csak ekkor tekinthetők lezártnak, ez a pont választja el "a rendszer működik" állapotot a "a rendszer production-ready" állapottól.
