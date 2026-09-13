/** A publisher-hosted image found inside the source article. The file is never copied. */
export interface SourceInlineImage {
  url: string;
  alt: string | null;
  caption: string | null;
  credit: string | null;
  width: number | null;
  height: number | null;
}

/** Public projection enriched with the publisher and original article link. */
export interface PublishedSourceInlineImage extends SourceInlineImage {
  sourceName: string;
  sourceUrl: string;
}

const IMAGE_TRANSFORM_QUERY_PARAMS = new Set([
  "auto",
  "crop",
  "fit",
  "fm",
  "format",
  "h",
  "height",
  "imwidth",
  "q",
  "quality",
  "r",
  "resize",
  "strip",
  "w",
  "width",
]);

/**
 * Stable identity for one publisher image across common CDN resize/crop URLs.
 * The returned key is for comparison only; the exact publisher URL remains
 * untouched for the remote embed.
 */
export function sourceImageIdentityKey(value: string): string {
  try {
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (IMAGE_TRANSFORM_QUERY_PARAMS.has(key.toLowerCase())) url.searchParams.delete(key);
    }
    url.searchParams.sort();
    url.pathname = url.pathname
      // Reach PLC sites use s1200d/s1200f for different presentations of one asset.
      .replace(/\/ALTERNATES\/s\d+[a-z]?\//i, "/ALTERNATES/source/")
      // WordPress and similar CDNs append a crop hash to the original filename.
      .replace(/_[a-f0-9]{6,}(?=\.[a-z0-9]{2,5}$)/i, "")
      // WordPress resized derivatives: photo-1200x771.jpg -> photo.jpg.
      .replace(/-\d{2,5}x\d{2,5}(?=\.[a-z0-9]{2,5}$)/i, "");
    if (/\.express\.co\.uk$/i.test(url.hostname)) {
      url.pathname = url.pathname.replace(/\/\d{2,5}x(?:\d{2,5})?\//i, "/source-size/");
    }
    return url.href;
  } catch {
    return value;
  }
}

export function deduplicateSourceImages<T extends { url: string }>(images: T[]): T[] {
  const seen = new Set<string>();
  return images.filter((image) => {
    const key = sourceImageIdentityKey(image.url);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
