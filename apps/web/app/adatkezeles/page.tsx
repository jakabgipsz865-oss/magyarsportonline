import type { Metadata } from "next";
import type { ReactNode } from "react";
import { SiteFooter } from "../../components/site-footer";

export const metadata: Metadata = {
  title: "Adatkezelési tájékoztató",
};

export default function PrivacyPage(): ReactNode {
  return (
    <main className="public-surface legal-page">
      <article>
        <h1>Adatkezelési tájékoztató</h1>
        <p className="legal-page__updated">Frissítve: 2026. szeptember 30.</p>

        <h2>Adatkezelő</h2>
        <dl className="legal-details">
          <dt>Név</dt>
          <dd>Lovas Zoltán</dd>
          <dt>Kapcsolat</dt>
          <dd>
            <a href="mailto:hello@mso24.hu">hello@mso24.hu</a>
          </dd>
        </dl>

        <h2>Milyen adatokat kezelünk?</h2>
        <p>
          Az oldalon nincs regisztráció, hozzászólás, kapcsolatfelvételi űrlap vagy hírlevél. A
          nyilvános oldalak nem helyeznek el látogatóazonosításra szolgáló sütit.
        </p>

        <h3>Az oldal biztonságos kiszolgálása</h3>
        <p>
          A tárhelyet, a tartalomtovábbítást és a biztonsági védelmet a Cloudflare, Inc. biztosítja.
          Ennek során technikai adatok — így különösen az IP-cím, a kért oldal címe, a kérés
          időpontja, valamint böngésző-, eszköz- és hálózati adatok — kezelhetők. A cél az oldal
          elérhető és biztonságos működése, a hibák felismerése és a visszaélések megakadályozása. A
          jogalap a GDPR 6. cikk (1) bekezdés f) pontja szerinti jogos érdek. Az MSO analytics
          táblái nem tárolnak ilyen hálózati naplókat; a Cloudflare technikai adatkezeléséről és
          megőrzéséről a szolgáltató adatvédelmi dokumentációja tájékoztat.
        </p>

        <h3>Opcionális, saját közönségmérés</h3>
        <p>
          Az MSO24 saját (first-party) statisztikája csak előzetes hozzájárulás után indul. Célja a
          szolgáltatás működésének és olvasottságának mérése, a népszerű tartalmak meghatározása,
          belső statisztika, valamint későbbi hirdetési és üzleti kapacitástervezés. Jogalapja a
          GDPR 6. cikk (1) bekezdés a) pontja szerinti hozzájárulás. Az opcionális
          végberendezés-tárolás és hozzáférés is csak hozzájárulás után történik.
        </p>
        <p>
          A „Statisztikai mérés engedélyezése” és a „Csak szükséges funkciók” egyenrangú
          választások. Nincs előre megadott hozzájárulás. Elutasításkor az oldal teljesen
          használható: nem jön létre analytics session ID, nem írunk analytics adatot a
          sessionStorage-ba, és nem küldünk PV- vagy Qualified Read-eseményt. A választás bármikor
          módosítható és az engedély visszavonható a „Statisztikai beállítások” gombbal.
        </p>
        <p>
          Az engedélyezett mérés oldalmegtekintéseket (PV), Browser sessionöket és érdemi
          cikkolvasásokat mér. Qualified Read akkor keletkezik, ha a cikk legalább 10 másodpercig
          látható, VAGY a cikkből legalább 25%-ot lefelé görgetett az olvasó. Egy cikkhez
          munkamenetenként legfeljebb egy ilyen olvasás kapcsolódik. A Qualified Read / article PV
          arány az érdemi olvasással rendelkező cikkoldali PV-k aránya; nem általános „engagement
          rate”.
        </p>
        <p>
          A böngészőfül sessionStorage tárhelyén véletlen session UUID-t (
          <code>mso:audience-session</code>), cikkenként véletlen eseményazonosítót és küldési
          állapotot (<code>mso:qr:…</code>), valamint legfeljebb 15 percig felhasználható belső
          navigációs jelzést (<code>mso:next-read</code>) használunk. A Browser session nem egyedi
          látogató. Az azonosító nem tartós látogatóazonosító: az adott böngészőfül munkamenetéhez
          kötődik. A böngésző munkamenet-visszaállítása vagy megnyitott fül másolása a
          sessionStorage-t is megőrizheti/másolhatja. Visszavonáskor az MSO analytics kulcsokat
          eltávolítjuk és az új mérést leállítjuk.
        </p>
        <p>
          A szükséges választási süti neve <code>mso_analytics_consent</code>; kizárólag az
          engedélyezés/elutasítás megjegyzésére szolgál, minden látogatónál ugyanazt a két rögzített
          értéket használja, azonosítót nem tartalmaz. Saját domainhez tartozik, megőrzése 90 nap,
          Path=/, SameSite=Lax; HTTPS-en Secure. Csak a kifejezett választáskor írjuk. Nem
          használható látogatókövetésre. Lejárata után ismét választást kérünk.
        </p>
        <p>
          A Cloudflare D1-be csak véletlen event ID, ephemeral session ID, nyilvános
          oldal/cikkazonosító, eseménytípus, kategorizált forrás
          (direct/internal/search/social/rss/referral/unknown), belső elhelyezési kategória,
          kapcsolódó PV event ID és szerveroldali időpont kerül. Nem tárolunk analytics célú
          IP-címet, user-agentet, teljes referrer URL-t vagy query stringet, emailt, account ID-t
          vagy más személyes azonosítót.
        </p>
        <p>
          A nyers, álnevesített PV/session/Qualified Read-eseményeket 32 napig (30 napos gördülő
          számítás és 2 nap biztonsági buffer) tartjuk meg. Az ötpercenkénti, korlátozott méretű
          törlés miatt a fizikai törlés a következő sikeres takarításkor történik; az admin mindig
          csak a kiválasztott időablakot számolja. A külön trending Qualified Read-eseménylista 48
          órát, ötperces összesítői 25 órát őriznek. A napi összesített PV/cikk-PV/Qualified
          Read/napi session-szám, forrás- és Story-szintű statisztikák az oldal teljes működési
          történetére megmaradnak. Ezekben nincs event ID, session ID vagy más látogatói azonosító.
          A visszavonás nem teszi jogellenessé a korábban, hozzájárulással végzett adatkezelést.
        </p>
        <p>
          Nem készül marketingprofil vagy fingerprint; nincs Google Analytics, Meta Pixel, harmadik
          fél marketing tracker vagy localStorage-ban tartós visitor ID. True UV és visszatérő
          látogató nem mérhető megbízhatóan ebből a rendszerből. A statisztika csak a
          hozzájárulással mért forgalmat mutatja, a nem mért közönséget nem becsüli hozzá.
        </p>
        <p>
          A Cloudflare accountban meglévő automatikus Web Analytics-beacon szerepel; annak böngészős
          futását az MSO web alkalmazás tartalombiztonsági szabálya (CSP) blokkolja. A saját mérés
          nem használ ilyen beacont. A Cloudflare tárhely- és hálózatbiztonsági működése ettől
          különálló.
        </p>
        <h3>Visszaélés elleni kéréskorlátozás</h3>
        <p>
          Az alkalmazás a proxy IP-fejléce alapján, kizárólag a Worker-példány átmeneti memóriájában
          korlátozza a publikus API-k kérési sebességét (120 kérés / 60 másodperc). Hiányzó
          fejlécnél közös „unknown” kategóriát használ. A memóriabeli kulcsok takarításkor vagy a
          Worker újraindulásakor megszűnnek; ez nem globális vagy tartós látogatói profil, és az IP
          nem kerül D1 analytics táblába.
        </p>

        <h3>Külső forrásból megjelenített képek</h3>
        <p>
          A cikkek képei közvetlenül az eredeti kiadó szerveréről töltődhetnek be. Ilyenkor a
          böngésző kapcsolatba lép az adott, a kép alatt megnevezett forrás szolgáltatójával, amely
          megkaphatja az IP-címet, a böngésző technikai adatait és a kért kép címét. A cél a
          forráshoz kötött illusztráció megjelenítése, a jogalap az adatkezelő jogos érdeke. Az
          eredeti kiadó önálló adatkezelőként a saját tájékoztatója szerint jár el.
        </p>

        <h3>E-mailes kapcsolat</h3>
        <p>
          Ha e-mailt küld, kezeljük az e-mail-címét, az üzenet tartalmát és az Ön által megadott
          további adatokat a megkeresés megválaszolásához. A jogalap az Ön kérésének teljesítése,
          illetve az ehhez fűződő jogos érdek. A levelezést az ügy lezárásától számított legfeljebb
          1 évig őrizzük meg, kivéve, ha jogi igény miatt hosszabb megőrzés szükséges.
        </p>

        <h2>Adatfeldolgozó és adattovábbítás</h2>
        <p>
          A Cloudflare, Inc. a tárhelyhez, biztonsági szolgáltatáshoz és statisztikához kapcsolódó
          adatokat adatfeldolgozóként kezeli. Az Európai Gazdasági Térségen kívüli adatkezelésnél a
          GDPR szerinti megfelelő adattovábbítási garanciákat alkalmazza.
        </p>

        <h2>Az Ön jogai</h2>
        <p>
          Kérhet hozzáférést, helyesbítést, törlést vagy az adatkezelés korlátozását, és tiltakozhat
          a jogos érdeken alapuló adatkezelés ellen. Kérelmét az adatkezelő fenti e-mail-címére
          küldheti. Az oldal látogatóiról nem történik automatizált döntéshozatal vagy
          profilalkotás.
        </p>
        <p>
          Panasszal a Nemzeti Adatvédelmi és Információszabadság Hatósághoz fordulhat: 1055
          Budapest, Falk Miksa utca 9–11.; levelezési cím: 1363 Budapest, Pf. 9.; e-mail:{" "}
          <a href="mailto:ugyfelszolgalat@naih.hu">ugyfelszolgalat@naih.hu</a>.
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
