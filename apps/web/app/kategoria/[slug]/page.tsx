import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { StoryRiver } from "../../../components/story-river";
import { createRepositories } from "../../../lib/db";
import { toStorySummaryView } from "../../../lib/story-view";

export const dynamic = "force-dynamic";

const CATEGORY_STORY_LIMIT = 40;

interface PageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const { categoryRepository } = createRepositories();
  const category = await categoryRepository.getBySlug(slug);
  return category ? { title: category.nameHu } : {};
}

/**
 * A `stories.category_id` egyelőre minden Story-n `null` (a Story Merge
 * Agent MVP-scope-ja, docs/adr/0005-mvp-end-to-end-scope-cuts.md), az egyetlen
 * jelenleg befogadott forrás pedig kizárólag labdarúgás-hír — ezért ez az
 * oldal a "labdarugas" kategóriára az összes publikált Story-t mutatja
 * (ami ténylegesen helyes), más kategória-slugra pedig 404-et ad, nem üres
 * listát vagy kitalált szűrést.
 */
export default async function CategoryPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const { categoryRepository, storyReadModelRepository } = createRepositories();
  const category = await categoryRepository.getBySlug(slug);
  if (!category) {
    notFound();
  }

  const rows = await storyReadModelRepository.listPublished({
    limit: CATEGORY_STORY_LIMIT,
    offset: 0,
  });
  const stories = rows.map(toStorySummaryView);

  return (
    <main className="public-surface">
      <div className="taxonomy-header">
        <div className="taxonomy-header__mark" aria-hidden="true">
          {category.nameHu.slice(0, 2).toUpperCase()}
        </div>
        <h1>{category.nameHu}</h1>
      </div>
      <StoryRiver stories={stories} />
    </main>
  );
}
