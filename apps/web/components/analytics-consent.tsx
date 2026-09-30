"use client";
import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { clearAnalyticsStorage, consentCookie, readConsent, type Consent } from "../lib/audience";
const Context = createContext<Consent>(null);
export function useAnalyticsConsent(): boolean {
  return useContext(Context) === "allow";
}
export function AnalyticsConsent({ children }: { children: ReactNode }) {
  const [choice, setChoice] = useState<Consent>(null),
    [ready, setReady] = useState(false),
    [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const path = usePathname();
  useEffect(() => {
    setChoice(readConsent(document.cookie));
    setReady(true);
    function sync() {
      const next = readConsent(document.cookie);
      setChoice(next);
      if (next !== "allow") {
        try {
          clearAnalyticsStorage(sessionStorage);
        } catch {
          /* Optional storage blocked. */
        }
      }
    }
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("mso:consent-preference")
        : null;
    if (channel) channel.onmessage = sync;
    document.addEventListener("visibilitychange", sync);
    return () => {
      channel?.close();
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);
  function choose(next: Exclude<Consent, null>) {
    document.cookie = consentCookie(next, location.protocol === "https:");
    if (next === "deny") {
      try {
        clearAnalyticsStorage(sessionStorage);
      } catch {
        /* Optional storage may be disabled. */
      }
    }
    setChoice(readConsent(document.cookie));
    const channel =
      typeof BroadcastChannel !== "undefined"
        ? new BroadcastChannel("mso:consent-preference")
        : null;
    channel?.postMessage(next);
    channel?.close();
    setOpen(false);
  }
  const publicRoute = !path.startsWith("/admin") && !path.startsWith("/internal");
  return (
    <Context.Provider value={choice}>
      {children}
      {publicRoute && ready && (
        <>
          <button
            className="consent-settings"
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open || (choice === null && !dismissed)}
          >
            Statisztikai beállítások
          </button>
          {(open || (choice === null && !dismissed)) && (
            <section className="consent-panel" aria-label="Statisztikai mérés választása">
              <button
                className="consent-close"
                type="button"
                onClick={() => {
                  setDismissed(true);
                  setOpen(false);
                }}
              >
                {choice === "allow" ? "Bezárás" : "Bezárás · mérés nélkül"}
              </button>
              <h2>Statisztikai mérés</h2>
              <p>
                Engedélyeddel saját, rövid életű azonosítókkal mérjük az oldalmegtekintéseket és az
                érdemi olvasást. Nincs marketingprofil. Az oldal mérés nélkül is teljesen
                használható.
              </p>
              <p>
                <a href="/adatkezeles">Adatkezelési tájékoztató</a> · A választást itt bármikor
                módosíthatod.
                {choice &&
                  ` Jelenleg: ${choice === "allow" ? "engedélyezve" : "csak szükséges funkciók"}.`}
              </p>
              <div className="consent-actions">
                <button type="button" onClick={() => choose("allow")}>
                  Statisztikai mérés engedélyezése
                </button>
                <button type="button" onClick={() => choose("deny")}>
                  Csak szükséges funkciók
                </button>
              </div>
            </section>
          )}
        </>
      )}
    </Context.Provider>
  );
}
