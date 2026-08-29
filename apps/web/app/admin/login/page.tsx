import type { ReactNode } from "react";
import { safeAdminRedirect } from "../../../lib/admin-auth";

export const dynamic = "force-dynamic";

interface LoginPageProps {
  searchParams: Promise<{ error?: string; loggedOut?: string; next?: string }>;
}

export default async function AdminLoginPage({ searchParams }: LoginPageProps): Promise<ReactNode> {
  const params = await searchParams;
  const next = safeAdminRedirect(params.next ?? null);
  const message =
    params.error === "invalid"
      ? "A megadott admin jelszó hibás."
      : params.error === "disabled"
        ? "Az admin belépés nincs konfigurálva ebben a környezetben."
        : params.loggedOut === "1"
          ? "Sikeresen kijelentkeztél."
          : null;

  return (
    <main
      style={{
        minHeight: "100vh",
        display: "grid",
        placeItems: "center",
        padding: 20,
        background: "#f6f7f8",
      }}
    >
      <section
        style={{
          width: "100%",
          maxWidth: 400,
          padding: 28,
          border: "1px solid #d0d7de",
          borderRadius: 12,
          background: "white",
          boxShadow: "0 8px 28px rgba(0, 0, 0, 0.08)",
        }}
      >
        <p style={{ margin: "0 0 8px", color: "#57606a", fontWeight: 600 }}>MagyarSportOnline</p>
        <h1 style={{ margin: "0 0 8px" }}>Admin belépés</h1>
        <p style={{ margin: "0 0 22px", color: "#57606a" }}>Add meg a production admin jelszót.</p>

        {message ? (
          <p
            role={params.error ? "alert" : "status"}
            style={{
              padding: 10,
              borderRadius: 6,
              background: params.error ? "#fff0f0" : "#dafbe1",
              color: params.error ? "#cf222e" : "#116329",
            }}
          >
            {message}
          </p>
        ) : null}

        <form action="/admin/login/session" method="post">
          <input type="hidden" name="next" value={next} />
          <label htmlFor="admin-password" style={{ display: "block", marginBottom: 8 }}>
            <strong>Admin jelszó</strong>
          </label>
          <input
            id="admin-password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            autoFocus
            style={{
              boxSizing: "border-box",
              width: "100%",
              padding: "10px 12px",
              border: "1px solid #8c959f",
              borderRadius: 6,
              fontSize: 16,
              marginBottom: 16,
            }}
          />
          <button
            type="submit"
            style={{
              width: "100%",
              padding: "10px 14px",
              border: 0,
              borderRadius: 6,
              background: "#24292f",
              color: "white",
              fontSize: 16,
              fontWeight: 700,
              cursor: "pointer",
            }}
          >
            Belépés
          </button>
        </form>
      </section>
    </main>
  );
}
