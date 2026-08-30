import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { deduplication } from "@magyarsportonline/agents";
import { StoryRiver } from "../../../components/story-river";
import { createRepositories } from "../../../lib/db";
import { entitySlug } from "../../../lib/entity-slug";
import { toStorySummaryView } from "../../../lib/story-view";

const { entityMatchesText } = deduplication;

export const dynamic = "force-dynamic";

const ENTITY_STORY_SCAN_LIMIT = 200;

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function findEntity(slug: string) {
  const { entityRepository } = createRepositories();
  const entities = await entityRepository.listAll();
  return entities.find((entity) => entitySlug(entity) === slug) ?? null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const entity = await findEntity(slug);
  return entity ? { title: entity.nameHu } : {};
}

/**
 * Nincs a rendszerben `story_entities` kapcsolat feltöltve egyik agent
 * által sem (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 3 — csak
 * a Dedup Agent fingerprint-jéhez használt egyszeri egyeztetés létezik,
 * sosem íródik ki kapcsolótáblába), ezért ez az oldal olvasás-időben,
 * ugyanazzal a determinisztikus alias-egyeztetéssel (`entityMatchesText`)
 * szűri a publikált Story-kat cím/lead alapján, mint amit a Dedup Agent a
 * fingerprinthez használ — valódi, ellenőrizhető egyezés, nem kitalált adat.
 */
export default async function EntityPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const entity = await findEntity(slug);
  if (!entity) {
    notFound();
  }

  const { storyReadModelRepository } = createRepositories();
  const rows = await storyReadModelRepository.listPublished({
    limit: ENTITY_STORY_SCAN_LIMIT,
    offset: 0,
  });
  const stories = rows
    .map(toStorySummaryView)
    .filter((story) => entityMatchesText(entity, `${story.title} ${story.lead}`));

  return (
    <main className="public-surface">
      <div className="taxonomy-header">
        <div className="taxonomy-header__mark" aria-hidden="true">
          {entity.nameHu.slice(0, 2).toUpperCase()}
        </div>
        <h1>{entity.nameHu}</h1>
      </div>
      <StoryRiver stories={stories} />
    </main>
  );
}
