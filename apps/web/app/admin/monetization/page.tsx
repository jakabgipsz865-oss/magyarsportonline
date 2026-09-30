import Link from "next/link";
import { d1Binding } from "../../../lib/db";
import { audienceReport, type TopContent } from "../../../lib/audience-store";
import { monetizationEstimates } from "../../../lib/monetization";
import { TowerShell } from "../_components/tower-shell";
export const dynamic = "force-dynamic";
const number = (n: number) => n.toLocaleString("hu-HU", { maximumFractionDigits: 2 });
const ratio = (q: number, p: number) => (p ? `${number((q / p) * 100)}%` : "Nincs nevező");
function Top({ rows }: { rows: TopContent[] }) {
  return (
    <ol>
      {rows.map((t) => (
        <li key={t.story_id}>
          <Link href={`/hir/${t.slug}`}>{t.title_hu}</Link> · {t.pv} PV · {t.qualified} Qualified
          Read · {ratio(t.qualifiedViews, t.pv)} QR / article PV
        </li>
      ))}
    </ol>
  );
}
export default async function MonetizationPage() {
  const db = d1Binding(),
    report = db ? await audienceReport(db) : null;
  const month = report?.periods.find((p) => p.days === 30);
  const estimate = monetizationEstimates(
    month?.complete
      ? { source: "verified_existing", monthlyPageviews: month.pv, uniqueVisitorsByDay: null }
      : null,
  );
  return (
    <TowerShell path="/admin/monetization" title="Monetizáció · belső mérési nézet">
      <p>
        Saját, hozzájárulás után mért forgalom. A hozzájárulást elutasító és a JavaScriptet blokkoló
        olvasók nem szerepelnek az adatokban. Ezek nem a teljes közönség becsült számai.
      </p>
      <p>
        Mérés indulása: {report?.startedAt ?? "Még nincs elfogadott esemény"}.{" "}
        {month?.complete
          ? "Teljes gördülő 30 napos mérési időablak."
          : "Részleges időablak: még nincs teljes gördülő 30 nap. Ez nem történeti adatvesztés; a napi összesítések az indulástól megmaradnak."}
      </p>
      <Link href="/admin/monetization/export">CSV export · csak aggregált riport</Link>
      <h2>Közönségmutatók</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Mutató</th>
              <th>24h</th>
              <th>7 nap</th>
              <th>30 nap · gördülő</th>
            </tr>
          </thead>
          <tbody>
            {(
              ["pv", "sessions", "pvSession", "qualified", "qrRatio", "uv", "returning"] as const
            ).map((k) => (
              <tr key={k}>
                <th>
                  {
                    {
                      pv: "PV",
                      sessions: "Browser session",
                      pvSession: "PV / Browser session",
                      qualified: "Qualified Read",
                      qrRatio: "Qualified Read / article PV",
                      uv: "True UV",
                      returning: "Returning user",
                    }[k]
                  }
                </th>
                {[1, 7, 30].map((d) => {
                  const p = report?.periods.find((x) => x.days === d);
                  const value = !p
                    ? "Nincs jelenleg mérve"
                    : k === "uv" || k === "returning"
                      ? "Nincs jelenleg megbízhatóan mérve"
                      : k === "pvSession"
                        ? p.sessions
                          ? number(p.pv / p.sessions)
                          : "Nincs nevező"
                        : k === "qrRatio"
                          ? ratio(p.qualifiedViews, p.articlePv)
                          : number(p[k]);
                  return (
                    <td key={d}>
                      {value}
                      {p && !p.complete && !["uv", "returning"].includes(k) && (
                        <small> · részleges</small>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p>
        Browser session: sessionStorage-ban tárolt véletlen, böngészőfül-munkamenethez tartozó
        azonosító; nem egyedi látogató. Minden időablak külön DISTINCT session-számot használ, nem a
        napi számok összegét. A böngésző munkamenet-visszaállítása megtarthatja a tárhelyet.
      </p>
      <p>
        Qualified Read: 10 másodperc látható idő VAGY 25% cikk-scroll; session/cikk deduplikáció.
        Érdemi olvasás arány a cikkoldali PV-k között: az időablakban mért cikk-PV-k közül azok
        aránya, amelyekhez Qualified Read kapcsolódott. Nem általános iparági engagement rate. A
        külön QR-szám az esemény ideje szerinti darabszám, ezért az időablak szélén eltérhet az
        arány számlálójától.
      </p>
      <h2>Inventory · BECSLÉS</h2>
      {estimate.inventory ? (
        <ul>
          {estimate.inventory.map((i) => (
            <li key={i.slots}>
              {i.slots} slot · 100% elméleti: {number(i.theoretical)} · 70% értékesíthető becslés:{" "}
              {number(i.sellable)}
            </li>
          ))}
        </ul>
      ) : (
        <p>Hiteles, teljes 30 napos mért PV nélkül az inventory-becslés nem számítható.</p>
      )}
      <p>
        Alap: hozzájárult forgalom gördülő 30 napos PV × 1 / 2 / 3 slot. A nem mért közönségre nem
        extrapolálunk.
      </p>
      <h2>BELSŐ KERESKEDELMI MUNKAKÜSZÖB</h2>
      <p>A belső UV-küszöb jelenleg nem értékelhető.</p>
      <ul>
        <li>3 000 napi UV: médiakit előkészítés</li>
        <li>5 000 napi UV: direkt hirdetés</li>
        <li>15 000 napi UV: professzionális sales</li>
      </ul>
      <p>
        A Cloudflare meglévő Web Analytics API-ja ad PV/visits adatot, de nincs az adminba
        integrálva; a visits nem Browser session vagy True UV. True UV és returning user nem
        helyettesíthető PV-vel vagy sessionnel. Korábbi, automatikusan beillesztett
        Cloudflare-beacon futását a web alkalmazás CSP-je blokkolja; account-beállítás nem
        változott.
      </p>
      {report?.periods.map((p) => (
        <section key={p.days}>
          <h2>
            {p.days === 1 ? "24h" : `${p.days} nap · gördülő`}
            {!p.complete ? " · részleges" : ""}
          </h2>
          <h3>TOP10 · PV</h3>
          <Top rows={p.topPv} />
          <h3>TOP10 · Qualified Read</h3>
          <Top rows={p.topReads} />
          <h3>Forráskategóriák</h3>
          <ul>
            {p.sources.map((s) => (
              <li key={s.source}>
                {s.source}: {s.pv} PV · {s.qualified} Qualified Read
              </li>
            ))}
          </ul>
        </section>
      ))}
      <h2>Teljes történet · napi aggregátumok</h2>
      <p>
        {report?.history.days ?? 0} mért UTC nap · {report?.history.pv ?? 0} PV ·{" "}
        {report?.history.qualified ?? 0} Qualified Read az indulástól. Napi és Story-szintű
        összesítések a szolgáltatás teljes működési történetére megmaradnak, látogatói azonosító
        nélkül.
      </p>
      <p>
        A séma támogatja a naptári hónap/előző hónap/év/indulástól riportok későbbi megjelenítését.
        A hosszú távú napi session-összegek nem időszaki deduplicált sessionök. Előző 30 napos
        trendet nem állítunk elő a 32 napos nyers tárolásból.
      </p>
    </TowerShell>
  );
}
