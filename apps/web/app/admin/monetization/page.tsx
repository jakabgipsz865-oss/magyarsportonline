import Link from "next/link";
import { d1Binding } from "../../../lib/db";
import { qualifiedReadSummary } from "../../../lib/control-tower";
import { monetizationEstimates } from "../../../lib/monetization";
import { TowerShell, Metrics } from "../_components/tower-shell";
export const dynamic = "force-dynamic";
const missing = "Nincs jelenleg megbízható adatforrás az admin számára";
const metrics = [
  "UV",
  "PV",
  "Session",
  "PV/session",
  "Session/user",
  "Returning users",
  "Engagement",
  "Traffic sources",
];
export default async function MonetizationPage() {
  const db = d1Binding(),
    qualified = db ? await qualifiedReadSummary(db) : null;
  // No existing programmatic UV/PV/session provider is configured. Never substitute reads.
  const estimate = monetizationEstimates(null);
  return (
    <TowerShell path="/admin/monetization" title="Monetizáció · belső mérési nézet">
      <Metrics
        items={[
          {
            label: "Érdemi cikkolvasás / Qualified reads · 24h",
            value: qualified?.count ?? "Nincs jelenleg mérve",
            note: "Deduplicált qualified_read események; nem UV, PV vagy session",
          },
        ]}
      />
      <h2>Közönségmutatók</h2>
      <div className="admin-table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              <th>Mutató</th>
              <th>Napi</th>
              <th>Heti</th>
              <th>Havi</th>
            </tr>
          </thead>
          <tbody>
            {metrics.map((m) => (
              <tr key={m}>
                <th>{m}</th>
                <td>{missing}</td>
                <td>{missing}</td>
                <td>{missing}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <h2>Inventory · BECSLÉS</h2>
      {estimate.inventory ? (
        <ul>
          {estimate.inventory.map((i) => (
            <li key={i.slots}>
              {i.slots} slot · 100%: {i.theoretical} · 70%: {i.sellable}
            </li>
          ))}
        </ul>
      ) : (
        <p>Hiteles havi PV nélkül az inventory-becslés nem számítható.</p>
      )}
      <p>
        A majdani becslés: havi PV × 1 / 2 / 3 slot; elméleti 100% és 70%-os értékesíthető becslés.
      </p>
      <h2>BELSŐ KERESKEDELMI MUNKAKÜSZÖB</h2>
      <p>30 napos átlagos napi UV: {estimate.averageDailyUv ?? "Nincs jelenleg mérve"}.</p>
      <ul>
        <li>3 000 UV: médiakit előkészítés</li>
        <li>5 000 UV: direkt hirdetés</li>
        <li>15 000 UV: professzionális sales</li>
      </ul>
      <p>
        Belső munkaküszöbök; nem iparági minősítés vagy bevételi garancia. Hiteles UV nélkül nincs
        küszöbértékelés.
      </p>
      <h2>Érdemi olvasások · TOP5 / 24h</h2>
      <ol>
        {qualified?.top.map((row) => (
          <li key={row.story_id}>
            <Link href={`/hir/${row.slug}`}>{row.title_hu}</Link> · {row.count} qualified read
          </li>
        ))}
      </ol>
      <p>
        Heti és havi olvasási összesítés: nincs jelenleg megbízható adatforrás; az események rövid
        adatmegőrzése nem fed le ilyen időablakot.
      </p>
      <h2>Qualified-read belépési jelzés · 24h</h2>
      <ul>
        {qualified?.sources.map((row) => (
          <li key={row.source}>
            {row.source}: {row.count}
          </li>
        ))}
      </ul>
      <p>
        Ezek a qualified-read események belépési jelzései, nem teljes közönség- vagy
        forgalomforrás-mérés.
      </p>
    </TowerShell>
  );
}
