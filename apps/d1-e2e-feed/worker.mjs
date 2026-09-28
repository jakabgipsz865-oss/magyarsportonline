const body = `Arsenal announced a new football signing in this isolated test fixture. The club said that the player joined the team after the agreement was completed. The announcement came from the club itself and did not include a transfer fee. The player will train with the squad before the next match. The club said that further details about the player's first appearance will be shared later. This text exists only to exercise the MSO24 D1 ingestion and Writer pipeline in a separate test database. It is not a report of a real transfer, and the fixture is never a source for the production site.`;

export default {
  async fetch(request) {
    const url = new URL(request.url);
    const headers = { "cache-control": "no-store", "x-robots-tag": "noindex, nofollow" };
    if (url.pathname === "/feed.xml") {
      const article = new URL("/football-arsenal-fixture", url.origin).toString();
      const aiArticle = new URL("/football-arsenal-ai-fixture", url.origin).toString();
      const rejected = new URL("/recipe-fixture-filtered", url.origin).toString();
      const rss = `<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel>
        <title>MSO24 isolated D1 fixture</title><link>${url.origin}</link>
        <description>Automated test feed, not real news</description><item>
        <title>Arsenal football signing isolated test fixture</title>
        <link>${article}</link><guid isPermaLink="true">${article}</guid>
        <pubDate>Mon, 28 Sep 2026 15:30:00 GMT</pubDate>
        <description><![CDATA[${body}]]></description>
        </item><item>
        <title>Arsenal football signing AI pipeline fixture</title>
        <link>${aiArticle}</link><guid isPermaLink="true">${aiArticle}</guid>
        <pubDate>Mon, 28 Sep 2026 16:20:00 GMT</pubDate>
        <description><![CDATA[${body}]]></description>
        </item><item>
        <title>Autumn vegetable soup isolated test fixture</title>
        <link>${rejected}</link><guid isPermaLink="true">${rejected}</guid>
        <pubDate>Mon, 28 Sep 2026 15:31:00 GMT</pubDate>
        <description>An isolated soup recipe with carrots and potatoes.</description>
        </item></channel></rss>`;
      return new Response(rss, { headers: { ...headers, "content-type": "application/rss+xml; charset=utf-8" } });
    }
    if (url.pathname === "/football-arsenal-fixture" ||
        url.pathname === "/football-arsenal-ai-fixture") {
      const headline = url.pathname.endsWith("ai-fixture")
        ? "Arsenal football signing AI pipeline fixture"
        : "Arsenal football signing isolated test fixture";
      const structured = JSON.stringify({
        "@context": "https://schema.org", "@type": "NewsArticle",
        headline, articleBody: body,
        datePublished: url.pathname.endsWith("ai-fixture")
          ? "2026-09-28T16:20:00Z" : "2026-09-28T15:30:00Z",
        author: { "@type": "Organization", name: "MSO24 isolated fixture" },
      });
      const html = `<!doctype html><html lang="en"><head><title>Isolated D1 fixture</title>
        <script type="application/ld+json">${structured}</script></head><body>
        <article><h1>${headline}</h1>
        <p>${body}</p></article></body></html>`;
      return new Response(html, { headers: { ...headers, "content-type": "text/html; charset=utf-8" } });
    }
    return new Response("Not found", { status: 404, headers });
  },
};
