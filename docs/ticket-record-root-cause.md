# Bérletügy és Arsenal rekordhír — módosítás előtti audit

| SOURCE | TITLE | NORMALIZED ENTITIES | EVENT TYPE | EVENT KEY/FINGERPRINT | WHY NOT MATCHED |
|---|---|---|---|---|---|
| The Sun / SunSport Football | Man Utd brutally strip 685 fans of their season tickets and warn 464 more amid controversial ticket touting crackdown | team:manchester-united | null | event key=null; `8972b1c8649e12d994d9bf2b69e8b72b84d86e4c664946dfa1871a109de8fe72` | A ticket-enforcement típus hiányzik; a visszaeső hash sourceId/rawId-t használ. |
| Daily Star Football | Man Utd 'remove 685 season tickets' after controversial summer crackdown | team:manchester-united | null | event key=null; `b41bcc98905307899ea6269a54595b96ae9a12e68a518fff9744c385a92f2553` | A ticket-enforcement típus hiányzik; a visszaeső hash sourceId/rawId-t használ. |

A normalizált klub mindkét esetben azonos. A hiányzó komponens az eseménytípus; a 48 órás ablakhoz és a secondary entity összevetéshez a kód el sem jut. Fájl: packages/agents/src/tabloid-event.ts; describeTabloidEvent(types.length !== 1), resolveTabloidEvent(!descriptor).

## Arsenal

Best starts to the season EVER as Arsenal look to smash Chelsea’s 21-year-old record and continue incredible winning run

ARSENAL have enjoyed a flying start in their bid to win their first ever back-to-back Premier league titles. The Gunners finally broke their duck last season by winning their first Prem trophy since the Invincibles' 2004 triumph. And the North Londoners have won all three of their opening matches this term in the English top...

Besorolás: sporteredmény/rekord/versenyteljesítmény, REJECT. A tabloid.ts offField regexének önálló look szava a look to smash kifejezésre illeszkedik. Ez true-ra állítja offFieldHeadline-t, így a matchNews win/won egyezéseit figyelő feltétel kimarad. A visszatérési feltételben ugyanez az offField egyezés ACCEPT-et ad.

Audit elkészült az alkalmazáskód módosítása előtt.
