import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";
import { toStoryDetailView } from "../../../lib/story-view";

// DB-driven, always-fresh — never statically prerendered at build time.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function loadStory(slug: string) {
  const { storyReadModelRepository } = createRepositories();
  const row = await storyReadModelRepository.getBySlug(slug);
  return row ? toStoryDetailView(row) : null;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await loadStory(slug);
  if (!story) {
    return {};
  }
  return {
    title: story.title,
    description: story.metaDescription ?? story.lead,
  };
}

/**
 * Publikus Story-oldal (docs/architecture/08-roadmap.md Fázis 9, 77-79. lépés).
 * Kizárólag a `story_read_model` CQRS-projekcióból olvas, sosem a
 * normalizált write-oldali táblákból közvetlenül.
 */
export default async function StoryPage({ params }: PageProps): Promise<ReactNode> {
  const { slug } = await params;
  const story = await loadStory(slug);
  if (!story) {
    notFound();
  }

  return (
    <main>
      <p>
        <Link href="/">← Vissza a főoldalra</Link>
      </p>
      <article>
        <h1>{story.title}</h1>
        <p>
          <strong>{story.lead}</strong>
        </p>
        {/* biztonságos: story.bodyHtml a projector (packages/agents/read-model-projector) HTML-escape-elt kimenete */}
        <div dangerouslySetInnerHTML={{ __html: story.bodyHtml }} />
      </article>

      <section>
        <h2>Források</h2>
        <ul>
          {story.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.name}
              </a>
            </li>
          ))}
        </ul>
      </section>

      {story.versionHistory.length > 1 && (
        <section>
          <h2>Frissítések</h2>
          <ul>
            {story.versionHistory.map((entry) => (
              <li key={entry.versionNumber}>
                <time dateTime={entry.createdAt}>
                  {new Date(entry.createdAt).toLocaleString("hu-HU")}
                </time>
                {" — "}
                {entry.changeSummary ?? "Kezdeti hír a rendelkezésre álló források alapján."}
              </li>
            ))}
          </ul>
        </section>
      )}

      <p>
        Megbízhatósági pontszám:{" "}
        {story.confidenceScore !== null ? story.confidenceScore.toFixed(2) : "n/a"}
        {story.isDeveloping ? " · Ez a sztori még alakul." : null}
      </p>
    </main>
  );
}
