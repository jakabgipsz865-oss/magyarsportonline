import type { Metadata } from "next";
import Link from "next/link";
import type { ReactNode } from "react";
import { SiteFooter } from "../../components/site-footer";

export const metadata: Metadata = {
  title: "Impresszum",
};

export default function ImpresszumPage(): ReactNode {
  return (
    <main className="public-surface legal-page">
      <article>
        <h1>Impresszum</h1>
        <dl className="legal-details">
          <dt>Weboldal</dt>
          <dd>MagyarSportOnline — magyarsportonline.hu</dd>
          <dt>Üzemeltető és a tartalomért felelős személy</dt>
          <dd>Lovas Zoltán magánszemély</dd>
          <dt>Kapcsolat</dt>
          <dd>
            <a href="mailto:lovas.zoltan1986@gmail.com">lovas.zoltan1986@gmail.com</a>
          </dd>
        </dl>

        <h2>Az oldal működése</h2>
        <p>
          A MagyarSportOnline magánszemélyként működtetett, nem üzletszerű, bevételt nem termelő
          hobbioldal. Az oldalon nincs hirdetés, előfizetés vagy értékesítés.
        </p>
        <p>
          A cikkek előállításában automatizált, mesterséges intelligenciát használó rendszer vesz
          részt. Az egyes cikkek alapjául szolgáló eredeti forrásokat és a külső forrásból
          beágyazott képek forrását az adott cikknél feltüntetjük.
        </p>
        <p>
          Helyesbítési vagy eltávolítási kérelem a fenti e-mail-címen küldhető. A személyes adatok
          kezeléséről az <Link href="/adatkezeles">adatkezelési tájékoztatóban</Link> olvashat.
        </p>
      </article>
      <SiteFooter />
    </main>
  );
}
