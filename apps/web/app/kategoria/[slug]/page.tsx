import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StoryRiver } from "../../../components/story-river";
import { SiteFooter } from "../../../components/site-footer";
import {
  ARCHIVE_PAGE_SIZE,
  archivePageUrl,
  parseArchivePage,
  visibleArchivePages,
} from "../../../lib/archive-pagination";
import { createPublicRepositories } from "../../../lib/db";
import { toStorySummaryView } from "../../../lib/story-view";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ oldal?: string | string[] }>;
}

export async function generateMetadata({ params, searchParams }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const page = parseArchivePage((await searchParams).oldal);
  const { categoryRepository } = createPublicRepositories();
  const category = await categoryRepository.getBySlug(slug);
  return category && page
    ? {
        title: page === 1 ? category.nameHu : `${category.nameHu} – ${page}. oldal`,
        alternates: { canonical: archivePageUrl(slug, page) },
      }
    : {};
}

/**
 * A `stories.category_id` egyelőre minden Story-n `null` (a Story Merge
 * Agent MVP-scope-ja, docs/adr/0005-mvp-end-to-end-scope-cuts.md), az egyetlen
 * jelenleg befogadott forrás pedig kizárólag labdarúgás-hír — ezért ez az
 * oldal a "labdarugas" kategóriára az összes publikált Story-t mutatja
 * (ami ténylegesen helyes), más kategória-slugra pedig 404-et ad, nem üres
 * listát vagy kitalált szűrést.
 */
export default async function CategoryPage({
  params,
  searchParams,
}: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const page = parseArchivePage((await searchParams).oldal);
  if (page === null) notFound();
  const { categoryRepository, storyReadModelRepository } = createPublicRepositories();
  const category = await categoryRepository.getBySlug(slug);
  if (!category) {
    notFound();
  }

  const total = await storyReadModelRepository.countPublished();
  const pageCount = Math.max(1, Math.ceil(total / ARCHIVE_PAGE_SIZE));
  if (page > pageCount) notFound();

  const rows = await storyReadModelRepository.listPublished({
    limit: ARCHIVE_PAGE_SIZE,
    offset: (page - 1) * ARCHIVE_PAGE_SIZE,
  });
  const stories = rows.map(toStorySummaryView);
  const pageNumbers = visibleArchivePages(page, pageCount);

  return (
    <main className="public-surface">
      <div className="taxonomy-header">
        <div className="taxonomy-header__mark" aria-hidden="true">
          {category.nameHu.slice(0, 2).toUpperCase()}
        </div>
        <h1>{category.nameHu}</h1>
      </div>
      <p className="archive-summary">
        {total} publikált hír · {page}. oldal / {pageCount}
      </p>
      <StoryRiver stories={stories} />
      {pageCount > 1 ? (
        <nav className="archive-pagination" aria-label="Hírarchívum lapozása">
          {page > 1 ? (
            <Link href={archivePageUrl(slug, page - 1)} rel="prev">
              ← Újabb hírek
            </Link>
          ) : (
            <span />
          )}
          <div className="archive-pagination__pages">
            {pageNumbers.map((number, index) => (
              <span key={number}>
                {index > 0 && number > pageNumbers[index - 1]! + 1 ? (
                  <span className="archive-pagination__gap" aria-hidden="true">
                    …
                  </span>
                ) : null}
                <Link
                  href={archivePageUrl(slug, number)}
                  aria-label={`${number}. oldal`}
                  aria-current={number === page ? "page" : undefined}
                >
                  {number}
                </Link>
              </span>
            ))}
          </div>
          {page < pageCount ? (
            <Link href={archivePageUrl(slug, page + 1)} rel="next">
              Régebbi hírek →
            </Link>
          ) : (
            <span />
          )}
        </nav>
      ) : null}
      <SiteFooter />
    </main>
  );
}
