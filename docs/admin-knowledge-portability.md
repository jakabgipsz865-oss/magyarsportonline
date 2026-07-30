# Admin tudás hordozhatósága

Az adminfelület `/admin/knowledge` oldala a rendszer szerkesztői tudását egyetlen,
ember által olvasható JSON-csomagba exportálja, majd ugyanott előnézettel és
tranzakciósan visszaállítja.

## A v1 csomag tartalma

- a kódban verziózott, 300+ tételes futballlexikon;
- a szerkesztői stílusguide;
- a publikálási és hitelességi szabályok ember által olvasható lenyomata;
- minden elfogadott szerkesztői korrekció;
- a korrekciókból levezetett tanult lexikon, tiltott tükörfordítások és
  preferált megfogalmazások;
- a teljes Source Registry konfiguráció az üzemeltetési időbélyegek nélkül;
- a korrekció-hatékonyság, publish review, Story-match review és missed-merge
  review döntésekből képzett, Story UUID-tól független tanulási minták.

A csomag `format`, `schemaVersion`, alkalmazás-commit, környezet és elemszám
metaadatot, valamint SHA-256 tartalmi lenyomatot tartalmaz.

## Biztonsági szabályok

- Az export sosem tartalmaz tokent, API-kulcsot, jelszót vagy más felismert
  titkot. Ezek helyén `__MSO_REDACTED__` áll, a maszkolt JSON-útvonalak pedig a
  `security.redactedPaths` listában szerepelnek.
- Meglévő Source importjakor a célkörnyezet titkos értéke változatlan marad.
- Maszkolt titkot tartalmazó, új Source mindig inaktívan jön létre.
- Source aktív/inaktív állapot csak az admin külön jelölőnégyzetes
  megerősítésével változhat.
- Az import nem töröl adatot.
- Az alkalmazás előtt kötelező előnézet készül. Az apply ugyanazt a SHA-256
  lenyomatot várja, ezért más fájl nem csúszhat be az előnézet után.
- A teljes írás egy adatbázis-tranzakcióban és advisory lock alatt fut.

## Idempotencia

A korrekció, Source és review-minta determinisztikus természetes/tartalmi kulcsot
kap. Ugyanaz a csomag újra importálható: változatlan rekordból nem lesz
duplikátum. Source esetén az alap-URL, szerkesztői tudásnál a rossz→jó minta
teljes tartalma a kulcs alapja.

## Környezetek közötti migráció

1. A forráskörnyezetben töltsd le a csomagot.
2. A célkörnyezet `/admin/knowledge` oldalán válaszd ki a JSON-fájlt.
3. Készíts előnézetet, és ellenőrizd az új/frissülő/változatlan darabszámokat.
4. Source aktiválási eltérésnél csak tudatosan engedélyezd az állapotok átvitelét.
5. Alkalmazd az ellenőrzött importot.
6. Azonnal készíthetsz új előnézetet ugyanazzal a fájllal; minden elemszámnak
   változatlan állapotot kell mutatnia.

A statikus lexikon és szabályok kódverzióhoz kötöttek. Eltérő lenyomatnál az
admin előnézet figyelmeztet: a DB-alapú tanult tudás importálható, de a teljes
kódszabály-visszaállításhoz ugyanazt az alkalmazás-commitot kell telepíteni.
