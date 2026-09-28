# Célzott RSS-hozzáférési ellenőrzés – 2026-09-28

2026-09-28 20:47:41–42 UTC között izolált Cloudflare remote Worker végezte a három kérést. A Worker a production `RssSourceAdapter`-rel azonos `Accept: application/rss+xml, application/atom+xml, application/xml, text/xml` fejléccel és 8 másodperces `AbortSignal.timeout` értékkel futott, az éles Worker `2026-09-12` kompatibilitási dátumával, `nodejs_compat` és `global_fetch_strictly_public` flagekkel. Nem használt sütit vagy hitelesítési adatot, nem módosított D1-et, és nem indított AI-hívást. A lenti részletek megtisztítottak; a nyers challenge-válaszok nincsenek a repóban.

| Forrás | Kért URL → végső URL | HTTP / Content-Type / `cf-mitigated` | Méret | Válasz eleje és a 431. oszlop környezete |
| --- | --- | --- | ---: | --- |
| The Sun / SunSport Football | `https://www.thesun.co.uk/sport/football/feed/` → ugyanaz | `200` / `text/html; charset=UTF-8` / hiányzik | 1 334 bájt | `<!DOCTYPE html><html lang="en">…<title>Verifying Device</title>`; 431 körül: `…toadmash-1.0.11.css…Verifying your device, please wait…` |
| talkSPORT Football | `https://talksport.com/football/feed` → ugyanaz | `200` / `text/html; charset=UTF-8` / hiányzik | 1 334 bájt | `<!DOCTYPE html><html lang="en">…<title>Verifying Device</title>`; 431 körül: `…toadmash-1.0.11.css…Verifying your device, please wait…` |
| Daily Express Football | `https://www.express.co.uk/posts/rss/67/football` → ugyanaz | `403` / `text/html` / hiányzik | 919 bájt | `<!DOCTYPE HTML PUBLIC…>`; 431 körül: `Request blocked. We can't connect to the server…` |

A The Sun és talkSPORT mentett válaszát a jelenlegi `rss-parser`-rel helyben újraparsolva mindkettő pontosan `Unexpected close tag; Line: 0; Column: 431; Char: >` hibát adott. Ezek HTML eszközellenőrző oldalak, nem RSS/Atom válaszok. A javítás kizárólag a HTML-dokumentum felismerését és a pontos hibaüzenetet érinti; nem oldja meg a kiadói hozzáférési korlátozást. A Daily Express 403-as tiltását a korábbi kód is HTTP-hibaként jelentette. Az elutasítások pontos kiadói oka nem bizonyított. A konfigurált feedeket nem kapcsoltuk ki és nem cseréltük más forrásra.
