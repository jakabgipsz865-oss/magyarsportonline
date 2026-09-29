export const ARCHIVE_PAGE_SIZE = 40;

export function parseArchivePage(value: string | string[] | undefined): number | null {
  if (value === undefined) return 1;
  if (typeof value !== "string" || !/^[1-9]\d*$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) ? page : null;
}

export function archivePageUrl(slug: string, page: number): string {
  const base = `/kategoria/${encodeURIComponent(slug)}`;
  return page === 1 ? base : `${base}?oldal=${page}`;
}

export function visibleArchivePages(current: number, total: number): number[] {
  const pages = new Set([1, total]);
  for (let page = Math.max(1, current - 2); page <= Math.min(total, current + 2); page++) {
    pages.add(page);
  }
  return [...pages].sort((a, b) => a - b);
}
