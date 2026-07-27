import { NextResponse, type NextRequest } from "next/server";

/**
 * HTTP Basic auth az admin/review felülethez (docs/architecture/04-api-spec.md
 * §4.2 admin API). Edge middleware — szándékosan NEM importálja a lib/env.ts
 * Zod-validált env-et: az edge bundle-nek csak az ADMIN_SECRET-re van
 * szüksége, és egy másik (itt nem használt) env-változó hibája nem döntheti
 * el az összes admin request sorsát. Ha ADMIN_SECRET nincs beállítva, az
 * admin felület 503-mal le van tiltva — nincs "nyitva felejtett" állapot.
 */
export function middleware(request: NextRequest): NextResponse {
  const adminSecret = process.env["ADMIN_SECRET"];
  if (!adminSecret || adminSecret.length < 8) {
    return new NextResponse("Admin interface disabled (ADMIN_SECRET not configured)", {
      status: 503,
    });
  }

  const header = request.headers.get("authorization") ?? "";
  if (header.startsWith("Basic ")) {
    try {
      const decoded = atob(header.slice("Basic ".length));
      const separator = decoded.indexOf(":");
      const user = decoded.slice(0, separator);
      const password = decoded.slice(separator + 1);
      if (user === "admin" && timingSafeEqualString(password, adminSecret)) {
        return NextResponse.next();
      }
    } catch {
      // rosszul kódolt fejléc → 401 lent
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="magyarsportonline admin"' },
  });
}

/** Konstans idejű összehasonlítás — a hossz eltérése önmagában is bukás. */
function timingSafeEqualString(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);
  let diff = aBytes.length ^ bBytes.length;
  const length = Math.max(aBytes.length, bBytes.length);
  for (let i = 0; i < length; i += 1) {
    diff |= (aBytes[i % aBytes.length || 0] ?? 0) ^ (bBytes[i % bBytes.length || 0] ?? 0);
  }
  return diff === 0;
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*"],
};
