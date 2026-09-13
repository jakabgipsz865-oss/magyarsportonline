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
        <p className="legal-page__updated">Hatályos: 2026. szeptember 13.</p>

        <h2>Adatkezelő</h2>
        <dl className="legal-details">
          <dt>Név</dt>
          <dd>Lovas Zoltán</dd>
          <dt>Kapcsolat</dt>
          <dd>
            <a href="mailto:lovas.zoltan1986@gmail.com">lovas.zoltan1986@gmail.com</a>
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
          jogalap a GDPR 6. cikk (1) bekezdés f) pontja szerinti jogos érdek. A technikai naplók
          megőrzési ideje legfeljebb 7 nap.
        </p>

        <h3>Látogatottsági statisztika</h3>
        <p>
          A Cloudflare Web Analytics összesített látogatási, oldalmegtekintési és teljesítményadatot
          készít. A szolgáltatás nem használ sütit, helyi tárhelyet vagy böngésző-ujjlenyomatot. A
          Cloudflare a látogató IP-címét a hozzá legközelebbi adatközpontban eldobja; azt a központi
          analitikai rendszerében nem tárolja. Az összesített statisztikák legfeljebb 6 hónapig
          érhetők el. A kezelés célja az oldal használatának és műszaki működésének megismerése,
          jogalapja az adatkezelő jogos érdeke.
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
