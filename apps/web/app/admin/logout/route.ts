import { NextResponse } from "next/server";

/**
 * HTTP Basic auth-nak nincs valódi szerveroldali "logout"-ja — a böngésző
 * cache-eli a jelszót az origin számára. A szokásos workaround: egy
 * MÁSIK realm-mel visszaadott 401, ami miatt a böngésző eldobja a korábban
 * elfogadott hitelesítő adatot és újra bekéri (2026-07-29). A middleware
 * matcherje (`/admin/:path*`) ezt az útvonalat is védi, de mivel itt direktben
 * 401-et adunk vissza, a middleware-en már soha nem jut túl `admin:jó jelszó`
 * fejléccel — pontosan ez a cél.
 */
export function GET(): NextResponse {
  return new NextResponse("Kijelentkezve. Zárd be ezt a lapot, vagy jelentkezz be újra.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="magyarsportonline admin (logged out)"' },
  });
}
