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
