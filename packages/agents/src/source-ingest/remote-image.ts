import { load } from "cheerio";
import type { SourceInlineImage } from "@magyarsportonline/shared";

export interface RemoteImage {
  url: string;
  source: "media:content" | "thumbnail" | "enclosure" | "og" | "twitter" | "json-ld";
  width: number | null;
  height: number | null;
}

export interface PublisherArticleMedia {
  primary: RemoteImage | null;
  inlineImages: SourceInlineImage[];
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

/** Known tiny images never win. Unknown-size RSS images need an HTML metadata fallback. */
export function selectRemoteImage(
  candidates: RemoteImage[],
  allowUnknown = false,
): RemoteImage | null {
  const eligible = candidates.filter(
    (image) =>
      remoteImageUrl(image.url) &&
      (image.width === null ? allowUnknown : image.width >= 800) &&
      (image.height === null || image.height >= 400),
  );
  return (
    eligible.sort((a, b) => {
      const tier = (image: RemoteImage) =>
        image.width !== null ? (image.width >= 1200 ? 2 : 1) : 0;
      return (
        tier(b) - tier(a) || (b.width ?? 0) * (b.height ?? 1) - (a.width ?? 0) * (a.height ?? 1)
      );
    })[0] ?? null
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
    else if (key === "twitter:image" || key === "twitter:image:src") add(value, "twitter");
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
    if (object["@graph"]) visit(object["@graph"]);
  };
  $('script[type="application/ld+json"]').each((_, element) => {
    try {
      visit(JSON.parse($(element).text()));
    } catch {
      /* Invalid publisher metadata is optional. */
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
  return selectRemoteImage(
    candidates.filter((image) => !knownTiny.has(image.url)),
    true,
  );
}

function srcsetUrl(value: string | undefined): string | null {
  if (!value) return null;
  const candidates = value
    .split(",")
    .map((item) => {
      const [url, descriptor = ""] = item.trim().split(/\s+/, 2);
      const width = Number(descriptor.replace(/w$/, ""));
      return { url, width: Number.isFinite(width) ? width : 0 };
    })
    .filter((item): item is { url: string; width: number } => Boolean(item.url));
  return candidates.sort((a, b) => b.width - a.width)[0]?.url ?? null;
}

/** Extract ordered article-body images without fetching the image files. */
export function inlineImagesFromHtml(html: string, articleUrl: string): SourceInlineImage[] {
  const $ = load(html);
  const roots = $("article").toArray();
  if (roots.length === 0) roots.push(...$("main").toArray());
  const root = roots.sort((a, b) => $(b).text().length - $(a).text().length)[0];
  if (!root) return [];
  const images: SourceInlineImage[] = [];
  const seen = new Set<string>();
  $(root)
    .find("figure img, p img")
    .each((_, element) => {
      if (images.length >= 8) return;
      const image = $(element);
      const candidate =
        srcsetUrl(image.attr("srcset") ?? image.attr("data-srcset")) ??
        image.attr("src") ??
        image.attr("data-src");
      if (!candidate) return;
      let resolved: string;
      try {
        resolved = new URL(candidate, articleUrl).href;
      } catch {
        return;
      }
      const url = remoteImageUrl(resolved);
      if (!url || seen.has(url)) return;
      const width = imageDimension(image.attr("width"));
      const height = imageDimension(image.attr("height"));
      if ((width !== null && width < 300) || (height !== null && height < 180)) return;
      const figure = image.closest("figure");
      const text = (value: string | undefined) => value?.replace(/\s+/g, " ").trim() || null;
      seen.add(url);
      images.push({
        url,
        alt: text(image.attr("alt")),
        caption: text(figure.find("figcaption").first().text()),
        credit: text(
          image.attr("data-credit") ??
            figure.find(".credit, .photo-credit, .copyright").first().text(),
        ),
        width,
        height,
      });
    });
  return images;
}

export function articleMediaFromHtml(html: string, articleUrl: string): PublisherArticleMedia {
  const primary = imageFromHtml(html, articleUrl);
  const inlineImages = inlineImagesFromHtml(html, articleUrl);
  const combined: SourceInlineImage[] = [];
  const seen = new Set<string>();
  const add = (image: SourceInlineImage) => {
    if (seen.has(image.url)) return;
    seen.add(image.url);
    combined.push(image);
  };
  if (primary) {
    add({
      url: primary.url,
      alt: null,
      caption: null,
      credit: null,
      width: primary.width,
      height: primary.height,
    });
  }
  inlineImages.forEach(add);
  return { primary, inlineImages: combined.slice(0, 8) };
}

/** Accepted articles only. Fetch HTML, never the referenced image, never follow access redirects. */
export async function fetchArticleImage(
  articleUrl: string,
  publisherUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<RemoteImage | null> {
  return (await fetchArticleMedia(articleUrl, publisherUrl, fetcher))?.primary ?? null;
}

/** Fetch one publisher HTML page and return remote image metadata only. */
export async function fetchArticleMedia(
  articleUrl: string,
  publisherUrl: string,
  fetcher: typeof fetch = fetch,
): Promise<PublisherArticleMedia | null> {
  if (!remoteImageUrl(articleUrl)) return null;
  const hostname = (url: string) => new URL(url).hostname.replace(/^(?:www|api|feeds)\./, "");
  const articleHost = hostname(articleUrl);
  const publisherHost = hostname(publisherUrl);
  if (
    articleHost !== publisherHost &&
    !articleHost.endsWith(`.${publisherHost}`) &&
    !publisherHost.endsWith(`.${articleHost}`)
  )
    return null;
  try {
    const response = await fetcher(articleUrl, {
      redirect: "manual",
      signal: AbortSignal.timeout(4000),
      headers: { Accept: "text/html", "User-Agent": "MagyarSportOnlineBot/1.0" },
    });
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
      return articleMediaFromHtml(html + decoder.decode(), articleUrl);
    } finally {
      await reader.cancel();
    }
  } catch {
    return null;
  }
}
