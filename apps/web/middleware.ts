import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, verifyAdminSessionToken } from "./lib/admin-auth";

/**
 * Aláírt, HttpOnly session cookie védi az admin/review felületet és a
 * `/internal/*` böngészős admin oldalakat. A login ugyanazt a szerveroldali
 * ADMIN_SECRET-et használja, mint a korábbi HTTP Basic auth, külső provider
 * és kliensoldali secret nélkül.
 * Edge middleware — szándékosan NEM importálja a lib/env.ts Zod-validált
 * env-et: az edge bundle-nek csak az ADMIN_SECRET-re van szüksége, és egy
 * másik (itt nem használt) env-változó hibája nem döntheti el az összes
 * admin request sorsát. Ha ADMIN_SECRET nincs beállítva, az admin felület
 * 503-mal le van tiltva — nincs "nyitva felejtett" állapot.
 */
export async function middleware(request: NextRequest): Promise<NextResponse> {
  const path = request.nextUrl.pathname;
  if (path === "/admin/login" || path.startsWith("/admin/login/") || path === "/admin/logout") {
    return NextResponse.next();
  }

  const adminSecret = process.env["ADMIN_SECRET"];
  if (!adminSecret || adminSecret.length < 8) {
    return new NextResponse("Admin interface disabled (ADMIN_SECRET not configured)", {
      status: 503,
    });
  }

  const token = request.cookies.get(ADMIN_SESSION_COOKIE)?.value;
  if (await verifyAdminSessionToken(token, adminSecret)) {
    return NextResponse.next();
  }

  if (path.startsWith("/api/admin/")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", `${path}${request.nextUrl.search}`);
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/admin/:path*", "/api/admin/:path*", "/internal/:path*"],
};
