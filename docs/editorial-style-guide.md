# MagyarSportOnline — szerkesztőségi stílus-guide

Ez a dokumentum a magyar sportújságírás vezető szereplőinek (Nemzeti Sport,
M4 Sport, Eurosport Magyarország, Origo Sport) valós, publikus cikkcímein és
idézetein alapuló stíluselemzés eredménye. Kizárólag **stílust** — cím-,
lead- és mondatszerkesztést, hangnemet, szóhasználatot — vizsgál, tartalmi
vagy szerkesztőségi irányvonalat nem másol.

A cél: az Editorial Rewrite Agent (lásd `packages/agents/src/editorial-rewrite`)
ez alapján fogalmazza át a Hungarian Writer Agent tényszerű, de gépiesen
semleges nyersanyagát olyan szövegre, ami egy valódi magyar sportportál
cikkének hat — **tényt sosem változtat, kizárólag a megfogalmazást**.

## 1. Mit figyeltünk meg (forráscímek, csak stílus szempontból)

- „Bosnyák csapatot vert az Újpest, kikapott Eszéken a Honvéd, duplán nyert
  a Vasas" (M4 Sport) — több eredmény egy összevont, felsorolásszerű címben.
- „106 percig bírta az egykapuzást Argentína, Torres góljával Spanyolország
  nyerte a labdarúgó-világbajnokságot" (M4 Sport) — konkrét szám a címben,
  ok-okozati szerkezet.
- „Kiállítás, bombagól, 89. perces egyenlítés: a Vasas emberhátrányban
  szerzett bravúrpontot a címvédő ETO ellen" (M4 Sport) — vesszős felsorolás
  kettőspont előtt, majd a lényegi mondat.
- „Döntött az MLSZ: nem lesz általános hidratációs szünet" (Nemzeti Sport)
  — szereplő + ige, kettőspont, majd a döntés tartalma.
- „Kétgólos győzelem a franciák ellen: Spanyolország 2010 után ismét
  vb-döntős" (Eurosport) — eredmény elöl, történelmi kontextus a
  kettőspont után.
- „Őrületes meccsen „hősi halált halt" a Zöld-foki Köztársaság a címvédő
  Argentína ellen" (M4 Sport) — átvitt értelmű kifejezés idézőjelben jelölve.
- „8 csapat maradt talpon — Ön szerint ki nyeri a 2026-os
  világbajnokságot?" (Origo) — olvasóhoz intézett kérdés, bevonó hangnem.
- „Igenis bebizonyítottuk, hogy középszerű játékosokkal is tudunk minőségi
  játékot nyújtani" — edzői nyilatkozat szó szerint, közvetlen idézetként.

**Következtetés:** a magyar sportsajtó címadása tényközpontú, de sosem
száraz — a drámai részletet (szám, eredmény, fordulat) előre hozza, gyakran
kettőspont vagy gondolatjel mögé rejtve a kifejtést.

## 2. Címek

- **Hossz:** 6–14 szó. A 4 szónál rövidebb cím semmitmondó, a 16 szónál
  hosszabb már alcímnek hat.
- **Szerkezet:** igés, cselekvő szerkezet ("X legyőzte Y-t", nem "X
  győzelme Y ellen"). A tárgy/ellenfél gyakran a mondat elejére kerül, ha az
  dramaturgiailag erősebb ("Bosnyák csapatot vert az Újpest").
  - Ha van szám vagy statisztika, kerüljön a címbe (percek, gólok,
    sorozatban hányadik győzelem/vereség) — ez konkretizál, nem absztrahál.
  - Kettőspont akkor jó eszköz, ha a kettőspont előtti rész önmagában is
    horog (esemény/döntés neve), a kettőspont utáni a kifejtés.
  - Átvitt értelmű, szleng vagy köznyelvi fordulat használható, de akkor
    idézőjelben jelöljük, hogy nem szó szerinti állítás
    ("„hősi halált halt"").
- **Amit kerülni kell:** angol szórend tükörfordítása, közhelyes
  sablonok ("Nagy meccs volt", "Fontos győzelem"), clickbait, ami a tényt
  eltitkolja ("Elképesztő dolog történt a meccsen — sosem hinnéd, mi").
- Tulajdonnevek (csapat, játékos, verseny) mindig az eredeti magyar
  átírásban/helyesírással szerepelnek, sosem fordítva.

## 3. Lead

- **Hossz:** 1–2 mondat, legfeljebb kb. 40 szó.
- **Feladata:** a cím drámai elemét egy mondatban kontextusba helyezi —
  ki, mi, hol, mikor, mekkora eredménnyel — anélkül, hogy megismételné a
  cím szó szerinti megfogalmazását.
- A lead SOSEM idézi szó szerint a törzs első mondatát — összefoglal, nem
  másol.
- Ha a hír fejlődő/frissülő ("isDeveloping"), a lead jelezheti ezt
  visszafogottan ("a részletek még alakulnak", "a klub egyelőre nem
  kommentálta").

## 4. Bekezdéshossz és a törzs szerkezete

- **2–4 mondat / bekezdés.** Az 5+ mondatos bekezdés online sportcikkben
  szinte sosem fordul elő — a mobilon olvasó közönség miatt a rövid
  bekezdés a norma.
- Az első bekezdés a lead-et bontja ki egy konkrét részlettel (pl. a gól
  perce, az eredmény pontos állása), nem ismétli meg azt.
- Minden további bekezdés **új információt** visz tovább — dátumot,
  számot, előzményt vagy következményt. Ismétlés (ugyanaz a tény
  átfogalmazva) tiltott.
- A cikk vége felé helyezhető a háttérmagyarázat és a tabellahelyzet/
  sorozat-kontextus (ld. 6. pont).
- Hosszú összetett mondatok helyett rövid, egyenes szórendű mondatok a
  jellemzők — a magyar sportújságírás nem szereti a többszörösen
  alárendelt mondatszerkezetet a törzsben (a címben igen, ott tömörít).

## 5. Hangnem

- Magabiztos, tényközlő, de nem semleges-unalmas: a dráma, a tét, a
  fordulat nyelvi szinten is érzékelhető ("bravúrpontot szerzett",
  "egykapuzást bírta ki", "kiejtette").
- Nem bulváros, nem szenzációhajhász — a dráma a **tényből** fakad
  (gólszám, percek, sorozat), nem a szófordulatból.
- Enyhe köznyelviség megengedett és jellemző (pl. "balhé", "sztori",
  "bravúr"), de trágárság vagy súlyosan bizalmaskodó hangnem nem.
- Második személyű megszólítás ritkán, csak bevonó kérdésekben vagy
  felsorolásoknál ("mutatjuk", "íme") — sosem a hír tényszerű részében.

## 6. Mikor használjunk idézetet

- **Igen:** amikor egy edző, játékos vagy hivatalos szereplő nyilatkozata
  a hír lényegi részét adja (indoklás, reakció, bejelentés) — ilyenkor a
  Fact Verification Agent által kinyert `quote` típusú tény szó szerint,
  forrás/nyilatkozó megjelölésével kerül a szövegbe.
- **Nem:** sosem szabad idézetet kitalálni vagy parafrazálni "mintha"
  idézet lenne. Ha nincs `quote` típusú tény, nincs idézőjeles mondat a
  cikkben.
- Az idézet a cikk közepén/végén jellemző, ritkán a lead-ben — a lead a
  tényt közli, az idézet azt színesíti/indokolja.

## 7. Mikor használjunk háttérmagyarázatot

- Amikor egy esemény önmagában nehezen értelmezhető enélkül: pl. egy
  eredmény tabellahelyzetre gyakorolt hatása, egy játékos korábbi
  szereplése, egy sorozat (hányadik egymás utáni győzelem/vereség),
  történelmi előzmény ("2010 után ismét vb-döntős").
- A háttérmagyarázat mindig a cikk **második felében** jelenik meg, rövid,
  1 bekezdésnyi terjedelemben — sosem az elején, mert az elveszi a hír
  frissesség-érzetét.
- Csak **igazolt tényre** épülhet (a Fact Verification Agent tényei közül),
  sosem feltételezésre vagy találgatásra.

## 8. Amit az Editorial Rewrite Agent SOSEM tehet meg

1. Nem adhat hozzá új tényt, számot, nevet, dátumot vagy állítást, ami a
   bemeneti szövegben nem szerepelt.
2. Nem változtathatja meg egy szám, eredmény, dátum vagy idézet tartalmát.
3. Nem törölhet olyan tényt, ami a bemeneti szövegben szerepelt (csak a
   megfogalmazást finomíthatja).
4. Nem találhat ki vagy fogalmazhat át idézetet — egy idézet vagy szó
   szerint marad, vagy nem szerepel a szövegben.

Ezt a pipeline nem csak a promptra bízza: minden átírás után a Hungarian
Writer Agent már meglévő tény-konzisztencia ellenőrzését (`selfCheckContent`)
futtatjuk újra az átírt szövegen — ha az ellenőrzés inkonzisztenciát jelez,
az átírás eldobásra kerül, és az eredeti (nem stilizált) verzió marad
érvényben.
