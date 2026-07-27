import { NextResponse } from "next/server";
import { env } from "../../../../lib/env";

/**
 * IDEIGLENES, csak diagnosztikai célú végpont — arra a kérdésre válaszol,
 * hogy a valódi Cloudflare Workers AI hívás miért esik vissza No-LLM módra
 * minden egyes cikknél (megfigyelve: 71/71 review queue item és az 1
 * publikált Story is a NoLlmClient placeholder szövegét kapta). Közvetlenül,
 * a Vercelen ténylegesen beállított CLOUDFLARE_ACCOUNT_ID/CLOUDFLARE_API_TOKEN
 * hitelesítő adatokkal hív egy minimális Cloudflare Workers AI kérést, és
 * visszaadja a nyers HTTP-státuszt + a Cloudflare hibaválasz törzsét — ez
 * biztonságos, mert a Cloudflare hibaválaszok sosem tartalmazzák a tokent.
 *
 * Nem publikus: a middleware matcher (`/api/admin/:path*`) ADMIN_SECRET HTTP
 * Basic auth mögé helyezi, ugyanúgy, mint az /admin/review felületet.
 *
 * A vizsgálat lezárása után ez a fájl törlésre kerül.
 */
export async function GET(): Promise<NextResponse> {
  if (!env.CLOUDFLARE_ACCOUNT_ID || !env.CLOUDFLARE_API_TOKEN) {
    return NextResponse.json({ error: "CLOUDFLARE_ACCOUNT_ID or CLOUDFLARE_API_TOKEN not set" });
  }

  const url = `https://api.cloudflare.com/client/v4/accounts/${encodeURIComponent(env.CLOUDFLARE_ACCOUNT_ID)}/ai/v1/chat/completions`;
  const started = Date.now();
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}`,
      },
      body: JSON.stringify({
        model: env.CLOUDFLARE_AI_MODEL,
        messages: [
          { role: "system", content: "Reply with exactly one word." },
          { role: "user", content: "Say OK." },
        ],
        max_tokens: 16,
      }),
    });
    const durationMs = Date.now() - started;
    const bodyText = await response.text();
    return NextResponse.json({
      accountIdLength: env.CLOUDFLARE_ACCOUNT_ID.length,
      model: env.CLOUDFLARE_AI_MODEL,
      httpStatus: response.status,
      durationMs,
      body: bodyText.slice(0, 2000),
    });
  } catch (error) {
    return NextResponse.json({
      accountIdLength: env.CLOUDFLARE_ACCOUNT_ID.length,
      model: env.CLOUDFLARE_AI_MODEL,
      networkError: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - started,
    });
  }
}
