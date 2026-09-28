# Adatkülönbség a teljes mentés után — 2026-09-28

**Állapot: a végső éles adatátállás blokkolt; a történeti mentés feldolgozása nem.**

## Bizonyított teljes mentés

Az utolsó valóban teljes, konzisztens mentés a `clean-prod-20260829` ág
`neondb` adatbázisáról **2026-09-27 18:02:49 UTC körül** készült
`neondb-clean-prod.full.dump` PostgreSQL 18 custom dump. SHA-256:
`f66162029950d6678267069ef398ad27dda4b300f313fa60c2c85acabf9a0f42`.
A dump önálló helyi PostgreSQL 18 adatbázisba hibamentesen visszaállt.
Mind a 28 tábla minden sora egyezik a korábbi táblánkénti exporttal:
26 731 rekord, nulla eltérés, 31 idegen kulcs. A történeti D1-adatállomány
ugyanezt a 28 tábla / 26 731 soros logikai tartalmat őrzi; a távoli, elkülönített
D1-export 28/28 tábla ellenőrzőösszegével egyezett. Ez **a mentéshez** való
egyezés, nem a mostani Neonhoz.

## A mentés után ténylegesen megőrzött adatok

| Időpont (UTC) | Bizonyíték | Határ |
| --- | --- | --- |
| 18:05 körül | `public_published_timeline_7d.csv`, 540 nyilvános cikk idővonala | Nyilvános API-minta, nem teljes adatbázis és nem követi a törlést vagy minden módosítást. |
| 18:20:37 | `exports/TABLES/*.jsonl`, 28 tábla; `MANIFEST.json` | A 18:02-es mentésből exportálva, **nem** újabb adatállapot. |
| 18:25:35 | `FRESH_STORY_20260927_*.csv`: a `13db9f6f-3055-45e4-985c-d131551144c2` story és kapcsolt raw, job, verzió, LLM, link számlálás | Legalább egy későbbi publikáció részleges, hiteles adatbázis-kivonata; nincs meg a kapcsolt sorok minden oszlopa és minden tábla. |
| 18:37–18:41 | `TABLE_RELATION_SIZES_LIVE.csv`, `DATABASE_SIZE_LIVE_20260927.csv` és a fenti friss cikk CSV-k | Méretmérés és egy kiválasztott történet; nem soronkénti delta. |
| 23:53:52 | Visszakapcsolt eredeti Neon-ágon read-only számlálás: raw 3336, stories 2355, jobs 3664, versions 2033 | Az eredeti dump arányában nettó +46, +43, +43, +42 sor. Nem bizonyítja az új rekordok összes ID-jét, a frissítéseket vagy a törléseket. |

A 23:06 körüli másik `pg_dump` az **véletlenül visszaállított, régi augusztusi**
ágról készült. A történeti dump és e dump azonosítóinak metszete a négy
központi táblában nulla (`raw_articles`, `stories`, `pipeline_jobs`,
`story_versions`); ezért ez nem használható a szeptemberi adatkülönbség
szinkronjára. Az ágat és a dumpot megőriztük.

## Helyreállítható és ismeretlen rész

A 18:02-es teljes adatállomány pontosan visszaállítható, a kiválasztott
18:25-ös cikk néhány későbbi ténye és kapcsolata bizonyítható. A friss cikk
CSV-i önmagukban nem elegendők az eredeti PostgreSQL sorok teljes
rekonstrukciójához vagy az összes kapcsolt D1-tábla konzisztens feltöltéséhez.
A 23:53-as nettó számlálásból nem vezethetők le a soronkénti beszúrások,
frissítések és törlések. Nincs teljes mentés vagy tranzakciós változásnapló a
18:02 utáni szakaszról. A nyilvános cikkoldal és cache nem tartalmazza a
privát táblákat, a verziótörténet minden részletét és a törlési eseményeket.

A jelenlegi Neon minden új PostgreSQL-kapcsolatot a havi ingyenes kvóta
túllépése miatt elutasít. Fizetős keretemelés nincs jóváhagyva, és újabb
blokkolt kapcsolódási próbát nem végzünk. Az átálláshoz minimálisan egy új,
teljes, konzisztens, **az eredeti frissebb ágról** készült export, vagy azzal
egyenértékű, minden tábla beszúrását, módosítását és törlését lefedő
hiteles delta szükséges, majd írásbefagyasztás, D1-egyeztetés és tesztelt
rollback. Enélkül a 18:02-es D1-állomány élesítése legalább a bizonyítottan
későbbi cikket és a nettó többletet kihagyná, valamint ismeretlen frissítéseket
vagy törléseket fordíthatna vissza. E kockázat elfogadásáról a felhasználó dönt;
nem állítottuk át az éles oldalt a régebbi állományra.
