import type { ReactNode } from "react";
import { AdminHeader } from "./admin-header";
import { runtimeEnvironment } from "../../../lib/runtime-environment";
export function TowerShell({
  path,
  title,
  children,
}: {
  path: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <main className="admin-page admin-tower">
      <AdminHeader activePath={path} />
      <section className="admin-dashboard__intro">
        <p className="admin-eyebrow">Automatizált szerkesztőség</p>
        <h1>{title}</h1>
        {runtimeEnvironment() === "preview" ? (
          <p className="admin-preview-note">Preview · izolált adatmásolat és tesztforgalom</p>
        ) : null}
        <p>Megfigyelés és audit · időablakok UTC szerint</p>
      </section>
      {children}
    </main>
  );
}
export function Metrics({
  items,
}: {
  items: Array<{ label: string; value: ReactNode; note?: string }>;
}) {
  return (
    <div className="admin-metric-grid">
      {items.map((item) => (
        <div className="admin-metric-card" key={item.label}>
          <strong>{item.label}</strong>
          <span className="admin-tower-value">{item.value}</span>
          {item.note ? <small>{item.note}</small> : null}
        </div>
      ))}
    </div>
  );
}
