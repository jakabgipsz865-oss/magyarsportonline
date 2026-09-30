import type { WriterHealth } from "../../../lib/writer-health";
import React from "react";

export function WriterHealthPanel({ health }: { health: WriterHealth }) {
  const message =
    health.status === "BLOCKED"
      ? health.reason === "monthly_budget"
        ? "Primary Writer blokkolva – MSO havi hard cap elérve"
        : health.reason === "daily_quota"
          ? "Primary Writer blokkolva – napi quota/request cap"
          : "Primary Writer blokkolva – AI szolgáltatói/billing hiba"
      : health.status === "OK"
        ? "Legutóbbi Primary Writer-hívás sikeres; nem credit-egyenleg ellenőrzés"
        : health.lastErrorAt
          ? "Utolsó Primary Writer-feldolgozás technikai hibával állt meg; ellenőrzés szükséges"
          : "Nincs friss sikeres Primary Writer-hívás; provider/billing elérhetőség nem igazolt";
  return (
    <section className="admin-dashboard__section" aria-label="AI Writer / Billing health">
      <h2>AI Writer / Billing health · {health.status}</h2>
      <p>
        <strong>{message}</strong>
      </p>
      <p>
        Biztonságos hibakód: {health.reason} · Utolsó siker: {health.lastSuccessAt ?? "Nincs"}
      </p>
      {health.lastErrorAt ? (
        <p>
          Utolsó hiba: {health.lastErrorAt} · Következő próbálkozás: {health.retryAt ?? "Nincs"}
        </p>
      ) : null}
      <p>Cloudflare credit-egyenleg: nincs programmatikusan bekötve.</p>
    </section>
  );
}
