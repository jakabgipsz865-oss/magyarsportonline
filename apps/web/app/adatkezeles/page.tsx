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

        <h2>Az oldal biztonságos működése</h2>
        <p>
          Az oldal kiszolgálását és védelmét a Cloudflare, Inc. biztosítja. Ehhez technikai adatok,
          például IP-cím, kért oldal, időpont, böngésző- és hálózati adatok kezelhetők. A cél az
          elérhetőség, a biztonság, a hibakezelés és a visszaélések megelőzése. Jogalap: jogos
          érdek, a GDPR 6. cikk (1) bekezdés f) pontja. A szolgáltató technikai adatkezeléséről és
          megőrzési szabályairól a{" "}
          <a href="https://www.cloudflare.com/privacypolicy/">
            Cloudflare adatvédelmi tájékoztatója
          </a>{" "}
          ad részletes információt.
        </p>

        <h2>Opcionális saját közönségmérés</h2>
        <p>
          Saját statisztikánk csak az Ön előzetes hozzájárulása után indul. Az oldal mérés nélkül is
          teljes értékűen használható. A „Statisztikai mérés engedélyezése” és a „Csak szükséges
          funkciók” egyenrangú választások. Engedélyét bármikor módosíthatja vagy visszavonhatja a
          „Statisztikai beállítások” gombbal. Visszavonáskor a további mérést leállítjuk és a
          böngészőben tárolt mérési azonosítókat eltávolítjuk. Ez a korábbi, hozzájárulással végzett
          adatkezelés jogszerűségét nem érinti.
        </p>
        <p>
          Oldalmegtekintéseket, böngészési munkameneteket és érdemi cikkolvasásokat mérünk, az
          érintett oldallal vagy cikkel, a forgalmi forrás kategóriájával és az esemény időpontjával
          együtt. Az érdemi olvasást a megtekintési idő és az olvasási előrehaladás alapján
          állapítjuk meg. A cél az olvasottság és a népszerű tartalmak megismerése, statisztikai
          riportok, valamint hirdetési és üzleti kapacitástervezés. Jogalap: hozzájárulás, a GDPR 6.
          cikk (1) bekezdés a) pontja. Az opcionális böngészős tárolás és hozzáférés is csak
          hozzájárulás után történik.
        </p>
        <p>
          Véletlen, rövid életű munkamenet-azonosítót használunk, tartós látogatóazonosítót nem.
          Nincs fingerprinting, marketingprofil, Google Analytics, Meta Pixel vagy harmadik fél
          marketingkövető. Mérési célból nem tárolunk IP-címet vagy tartós IP-profilt, illetve
          teljes hivatkozó webcímet. A munkamenetszám nem azonos az egyedi emberek számával: egyedi
          és visszatérő látogatói mutatót ebből mesterségesen nem állítunk elő. A statisztika csak a
          hozzájárulással mért forgalmat mutatja.
        </p>

        <h2>A választás megjegyzése</h2>
        <p>
          Saját domainhez tartozó technikai süti kizárólag az engedélyezés vagy elutasítás
          megjegyzését szolgálja. Látogatókövetésre nem használjuk, személyes látogatóazonosítót nem
          tartalmaz. Megőrzése 90 nap; lejárat után ismét választást kérünk.
        </p>

        <h2>Adatmegőrzés</h2>
        <p>
          A nyers, álnevesített mérési események megőrzési ideje 32 nap, ezután töröljük őket.
          Technikai üzemzavar esetén a törlés átmenetileg késhet; a megőrzési időn túli események
          nem részei a közönségriportoknak. A rövid távú népszerűségi eseményeket ennél rövidebb
          ideig tartjuk meg.
        </p>
        <p>
          A látogatói azonosító nélküli napi, cikk- és forrásszintű összesített statisztikákat
          hosszú távon, az oldal teljes működési történetére megőrizzük. Ezek nem tartalmaznak
          munkamenet-azonosítót vagy más látogatói azonosítót.
        </p>

        <h2>Külső képek</h2>
        <p>
          Egyes képek az eredeti kiadó szerveréről töltődhetnek be. Ilyenkor a böngésző kapcsolatba
          lép a megnevezett forrásszolgáltatóval, amely technikai adatokat, például IP-címet és
          böngészőadatokat kaphat meg. A cél az illusztráció megjelenítése, a jogalap az adatkezelő
          jogos érdeke. A forrásszolgáltató önálló adatkezelő, saját tájékoztatója szerint.
        </p>

        <h2>E-mailes kapcsolat</h2>
        <p>
          Megkereséskor e-mail-címét, üzenetét és az Ön által megadott adatokat a válaszadáshoz
          kezeljük. Jogalap a megkeresés megválaszolásához fűződő jogos érdek; szerződéskötési
          kérésnél az Ön kérésére tett lépések megtétele. A levelezést az ügy lezárásától legfeljebb
          1 évig őrizzük meg, kivéve, ha jogi igény miatt hosszabb megőrzés szükséges.
        </p>

        <h2>Adatfeldolgozó és nemzetközi adattovábbítás</h2>
        <p>
          A Cloudflare, Inc. a kiszolgáláshoz, biztonsághoz és saját statisztikához kapcsolódó
          adatokat adatfeldolgozóként kezeli. Az Európai Gazdasági Térségen kívüli továbbításnál a
          GDPR szerinti garanciák irányadók, így megfelelőségi határozat, vagy az Európai Bizottság
          által jóváhagyott szerződéses kikötések és szükség esetén kiegészítő védelmi intézkedések.
          A részletek a{" "}
          <a href="https://www.cloudflare.com/cloudflare-customer-dpa/">
            Cloudflare adatfeldolgozási feltételeiben
          </a>{" "}
          olvashatók.
        </p>

        <h2>Az Ön jogai</h2>
        <p>
          Kérhet hozzáférést, helyesbítést, törlést és az adatkezelés korlátozását. Jogos érdeken
          alapuló adatkezelés ellen tiltakozhat, hozzájárulását bármikor visszavonhatja, és a
          jogszabályi feltételek teljesülésekor adathordozhatóságot kérhet. Kérelmét a fenti
          e-mail-címre küldheti. Nincs Önre vonatkozó automatizált döntéshozatal vagy
          marketingprofil.
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
