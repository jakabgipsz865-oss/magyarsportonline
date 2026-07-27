import { createHash } from "node:crypto";
import { NextResponse } from "next/server";

/**
 * IDEIGLENES, csak diagnosztikai célú végpont — a CRON_SECRET tartalmát soha
 * nem adja vissza, kizárólag a hosszát és egy sha256-hash 12 hex karakteres
 * prefixét, ugyanazzal az algoritmussal, mint amit a GitHub Actions oldali
 * diagnosztika (.github/workflows/cloudflare-live-validation.yml) használ —
 * hogy a két környezet (Vercel Production, GitHub Actions repo secret)
 * összehasonlítható legyen anélkül, hogy bármelyik titok felfedésre kerülne.
 *
 * Nem publikus: a middleware matcher (`/api/admin/:path*`) ugyanazt az
 * ADMIN_SECRET HTTP Basic auth-ot kényszeríti ki rá, mint az /admin/review
 * felületre.
 *
 * A vizsgálat lezárása után ez a fájl (és a rá mutató hivatkozás) törlésre
 * kerül — nem marad tartósan a kódbázisban.
 */
export async function GET(): Promise<NextResponse> {
  const raw = process.env["CRON_SECRET"] ?? "";
  const sha256Prefix = createHash("sha256").update(raw, "utf8").digest("hex").slice(0, 12);
  return NextResponse.json({ length: raw.length, sha256Prefix });
}
