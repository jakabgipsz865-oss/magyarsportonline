import type { Metadata } from "next";
import type { ReactNode } from "react";
import { notFound } from "next/navigation";
import { Timeline } from "@/components/Timeline";
import { db } from "@/lib/db";
import { getPublishedStoryBySlug } from "@/lib/stories";

// MVP scope: no ISR/on-demand revalidation yet (that's Fázis 9,
// docs/architecture/08-roadmap.md 77. lépés) — every request reads
// story_read_model fresh, which is correct but not yet cache-optimized.
export const dynamic = "force-dynamic";

interface StoryPageProps {
  params: Promise<{ slug: string }>;
}

export async function generateMetadata({ params }: StoryPageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await getPublishedStoryBySlug(db, slug);
  if (!story) {
    return {};
  }
  return {
    title: story.titleHu,
    description: story.leadHu,
  };
}

function formatConfidence(score: number | null): string {
  if (score === null) return "ismeretlen";
  return `${Math.round(score * 100)}%`;
}

function formatDate(date: Date): string {
  return date.toLocaleString("hu-HU", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default async function StoryPage({ params }: StoryPageProps): Promise<ReactNode> {
  const { slug } = await params;
  const story = await getPublishedStoryBySlug(db, slug);

  if (!story) {
    notFound();
  }

  return (
    <main>
      <article>
        <p className="story-meta">
          {story.isDeveloping ? "Élő, fejlődő hír" : "Frissítve"}: {formatDate(story.lastUpdatedAt)}
          {" · "}
          Megbízhatósági pontszám: {formatConfidence(story.confidenceScore)}
        </p>
        <h1>{story.titleHu}</h1>
        <p className="story-lead">
          <strong>{story.leadHu}</strong>
        </p>
        {/*
          bodyHtml is server-generated and HTML-escaped at the source
          (packages/agents/src/read-model/index.ts escapeHtml) — never raw
          user input, so this dangerouslySetInnerHTML is safe.
        */}
        <div className="story-body" dangerouslySetInnerHTML={{ __html: story.bodyHtml }} />

        {story.sourcesSummary.length > 0 ? (
          <section aria-label="Források">
            <h2>Források</h2>
            <ul>
              {story.sourcesSummary.map((source) => (
                <li key={source.url}>
                  <a href={source.url} rel="noopener noreferrer" target="_blank">
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        ) : null}

        <Timeline entries={story.versionHistory} />
      </article>
    </main>
  );
}
