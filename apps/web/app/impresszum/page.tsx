import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Impresszum",
};

/**
 * A magyar sajtószabályozás (2010. évi CIV. törvény a sajtószabadságról és a
 * médiatartalmak alapvető szabályairól) kötelezővé teszi a felelős
 * szerkesztő és a kiadó adatainak nyilvános feltüntetését — ez jogi
 * követelmény, amit nem lehet automatizálni (lásd docs/feasibility-analysis.md
 * §9, docs/architecture/08-roadmap.md Fázis 0, 8. lépés).
 *
 * A lenti mezők ZÁRÓJELES, "KITÖLTENDŐ" jelölésű helyőrzői SZÁNDÉKOSAN nem
 * valós adatok — ezeket a tényleges üzemeltetőnek kell kitöltenie éles
 * indulás előtt, mert a Fázis 0 implementáció nem rendelkezik hiteles
 * cégjogi/szerkesztőségi adatokkal.
 */
export default function ImpresszumPage(): ReactNode {
  return (
    <main className="public-surface">
      <h1>Impresszum</h1>
      <p>
        <strong>
          Ez az oldal jelenleg fejlesztés alatt áll, a lenti adatok kitöltendő helyőrzők.
        </strong>{" "}
        Éles publikálás előtt a tényleges üzemeltetőnek/kiadónak hiteles adatokkal kell
        kiegészítenie.
      </p>
      <dl>
        <dt>Kiadó neve</dt>
        <dd>[KITÖLTENDŐ: kiadó cégneve]</dd>
        <dt>Székhely</dt>
        <dd>[KITÖLTENDŐ: székhely címe]</dd>
        <dt>Cégjegyzékszám</dt>
        <dd>[KITÖLTENDŐ: cégjegyzékszám]</dd>
        <dt>Felelős szerkesztő</dt>
        <dd>[KITÖLTENDŐ: felelős szerkesztő neve]</dd>
        <dt>Kapcsolat</dt>
        <dd>[KITÖLTENDŐ: e-mail elérhetőség]</dd>
      </dl>
      <p>
        A tartalmak előállításában AI-alapú, automatizált rendszer vesz részt, forrásmegjelöléssel
        és emberi felügyeleti eljárással — lásd a <code>docs/feasibility-analysis.md</code> és{" "}
        <code>docs/architecture/</code> dokumentációt.
      </p>
    </main>
  );
}
