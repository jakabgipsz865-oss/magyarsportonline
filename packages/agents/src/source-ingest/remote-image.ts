import { load } from "cheerio";

export interface RemoteImage {
  url: string;
  source:
    | "media:content"
    | "thumbnail"
    | "enclosure"
    | "og"
    | "twitter"
    | "json-ld"
    | "srcset"
    | "data-srcset";
  width: number | null;
  height: number | null;
}

export function imageDimension(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 && number <= 30_000 ? number : null;
}

/** Validate without resizing, rewriting, fetching or normalizing the stored URL. */
export function remoteImageUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) return null;
    if (
      !url.hostname.includes(".") ||
      /^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(
        url.hostname,
      ) ||
      url.hostname.includes(":")
    )
      return null;
    return value;
  } catch {
    return null;
  }
}

/** Prefer declared large images; unknown article-level metadata is an explicit fallback. */
export function selectRemoteImage(candidates: RemoteImage[]): RemoteImage | null {
  const small = (image: RemoteImage) =>
    (image.width !== null && image.width < 800) || (image.height !== null && image.height < 400);
  const knownSmall = new Set(candidates.filter(small).map((image) => image.url));
  const metadataRank = { og: 3, "json-ld": 2, twitter: 1 };
  const eligible = candidates.filter(
    (image) =>
      remoteImageUrl(image.url) &&
      !knownSmall.has(image.url) &&
      ((image.width !== null && image.width >= 800) ||
        (image.width === null && image.source in metadataRank)),
  );
  const tier = (image: RemoteImage) => (image.width !== null ? (image.width >= 1200 ? 3 : 2) : 1);
  const rank = (image: RemoteImage) => metadataRank[image.source as keyof typeof metadataRank] ?? 0;
  return (
    eligible.sort(
      (a, b) =>
        tier(b) - tier(a) ||
        (b.width ?? 0) - (a.width ?? 0) ||
        rank(b) - rank(a) ||
        (b.height ?? 0) - (a.height ?? 0),
    )[0] ?? null
  );
}

export function imageFromHtml(html: string, articleUrl: string): RemoteImage | null {
  const $ = load(html);
  // Do not extract anything behind a publisher's declared access restriction.
  if (
    $('script[type="application/ld+json"]')
      .toArray()
      .some((element) => /"isAccessibleForFree"\s*:\s*(?:false|"false")/.test($(element).text()))
  )
    return null;
  const candidates: RemoteImage[] = [];
  let og: RemoteImage | undefined;
  let twitter: RemoteImage | undefined;
  const add = (
    value: unknown,
    source: RemoteImage["source"],
    width?: unknown,
    height?: unknown,
  ) => {
    if (typeof value !== "string") return;
    let url = value;
    try {
      if (!/^https?:\/\//i.test(url)) url = new URL(url, articleUrl).href;
    } catch {
      return;
    }
    if (!remoteImageUrl(url)) return;
    const image = { url, source, width: imageDimension(width), height: imageDimension(height) };
    candidates.push(image);
    return image;
  };
  $("meta").each((_, element) => {
    const key = ($(element).attr("property") ?? $(element).attr("name") ?? "").toLowerCase();
    const value = $(element).attr("content");
    if (key === "og:image" || key === "og:image:url") og = add(value, "og");
    else if (key === "og:image:width" && og) og.width = imageDimension(value);
    else if (key === "og:image:height" && og) og.height = imageDimension(value);
    else if (key === "twitter:image" || key === "twitter:image:src")
      twitter = add(value, "twitter");
    else if (key === "twitter:image:width" && twitter) twitter.width = imageDimension(value);
    else if (key === "twitter:image:height" && twitter) twitter.height = imageDimension(value);
  });
  const addJsonImage = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(addJsonImage);
      return;
    }
    if (typeof value === "string") {
      add(value, "json-ld");
      return;
    }
    if (value && typeof value === "object") {
      const object = value as Record<string, unknown>;
      add(object["url"] ?? object["contentUrl"], "json-ld", object["width"], object["height"]);
    }
  };
  const visit = (value: unknown): void => {
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (!value || typeof value !== "object") return;
    const object = value as Record<string, unknown>;
    if (/Article|Posting/.test(String(object["@type"]))) addJsonImage(object["image"]);
    if (
      /ImageObject/.test(String(object["@type"])) &&
      !/logo|icon/i.test(String(object["@id"] ?? object["name"] ?? ""))
    )
      addJsonImage(object);
    if (object["@graph"]) visit(object["@graph"]);
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      visit(JSON.parse($(element).text()));
    } catch {
      /* Invalid publisher metadata is optional. */
    }
  });
  // Only article/primary-image srcsets; navigation, advertising and related-card images
  // cannot replace the article image. Widths are publisher declarations, not URL guesses.
  const primaryUrls = new Set(candidates.map((image) => image.url));
  $("img, source").each((_, element) => {
    const node = $(element);
    const articleImage = node.closest("article, [itemprop='articleBody']").length > 0;
    const declaredPrimary = [node.attr("src"), node.attr("data-src")].some(
      (url) => url && primaryUrls.has(url),
    );
    if (!articleImage && !declaredPrimary) return;
    if (
      node.closest("aside, nav, [role='navigation'], .related, .related-articles, .advertisement")
        .length
    )
      return;
    for (const attribute of ["srcset", "data-srcset"] as const) {
      for (const candidate of (node.attr(attribute) ?? "").split(/,\s*(?=https?:\/\/|\/)/)) {
        const match = candidate.trim().match(/^(\S+)\s+(\d+)w$/);
        if (match) add(match[1], attribute, match[2]);
      }
    }
  });
  // A duplicate metadata tag cannot hide the known small size of the same URL.
  const knownTiny = new Set(
    candidates
      .filter(
        (image) =>
          (image.width !== null && image.width < 800) ||
          (image.height !== null && image.height < 400),
      )
      .map((image) => image.url),
  );
  return selectRemoteImage(candidates.filter((image) => !knownTiny.has(image.url)));
}

/** Accepted articles only. HTML metadata; only same-article permanent canonical redirects. */
export async function fetchArticleImage(
  articleUrl: string,
  publisherUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<RemoteImage | null> {
  if (!remoteImageUrl(articleUrl)) return null;
  const hostname = (url: string) => new URL(url).hostname.replace(/^(?:www|api|feeds)\./, "");
  const publisherHost = hostname(publisherUrl);
  const articleHost = hostname(articleUrl);
  if (articleHost !== publisherHost && !articleHost.endsWith(`.${publisherHost}`)) return null;
  try {
    const signal = AbortSignal.timeout(4000);
    const options = {
      redirect: "manual" as const,
      signal,
      headers: { Accept: "text/html", "User-Agent": "MagyarSportOnlineBot/1.0" },
    };
    let response = await fetcher(articleUrl, options);
    const location = response.headers.get("location");
    if ([301, 308].includes(response.status) && location) {
      const original = new URL(articleUrl);
      const canonical = new URL(location, original);
      if (
        remoteImageUrl(canonical.href) &&
        canonical.hostname === original.hostname &&
        canonical.pathname.replace(/\/$/, "") === original.pathname.replace(/\/$/, "") &&
        canonical.search === original.search &&
        !(original.protocol === "https:" && canonical.protocol !== "https:")
      ) {
        await response.body?.cancel();
        response = await fetcher(canonical.href, options);
      }
    }
    if (
      !response.ok ||
      !/text\/html|application\/xhtml\+xml/i.test(response.headers.get("content-type") ?? "")
    ) {
      await response.body?.cancel();
      return null;
    }
    const reader = response.body?.getReader();
    if (!reader) return null;
    const decoder = new TextDecoder();
    let html = "";
    let size = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > 2_000_000) return null;
        html += decoder.decode(value, { stream: true });
      }
      return imageFromHtml(html + decoder.decode(), articleUrl);
    } finally {
      await reader.cancel();
    }
  } catch {
    return null;
  }
}
