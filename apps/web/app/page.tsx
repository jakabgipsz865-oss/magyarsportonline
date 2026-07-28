import Link from "next/link";
import type { ReactNode } from "react";
import { createRepositories } from "../lib/db";
import { toStorySummaryView } from "../lib/story-view";

// DB-driven, always-fresh listing — never statically prerendered at build time.
export const dynamic = "force-dynamic";

const HOMEPAGE_STORY_LIMIT = 20;

export default async function HomePage(): Promise<ReactNode> {
  const { storyReadModelRepository } = createRepositories();
  const rows = await storyReadModelRepository.listPublished({
    limit: HOMEPAGE_STORY_LIMIT,
    offset: 0,
  });
  const stories = rows.map(toStorySummaryView);

  return (
    <main>
      <h1 className="sr-only">Legfrissebb sporthírek</h1>

      {stories.length === 0 ? (
        <p className="empty-state">Még nincs publikált hír.</p>
      ) : (
        <ul className="story-list">
          {stories.map((story) => (
            <li key={story.id} className="story-card">
              <h2 className="story-card__title">
                <Link href={`/hir/${story.slug}`}>{story.title}</Link>
              </h2>
              <p className="story-card__lead">{story.lead}</p>
              <div className="story-card__meta">
                <time dateTime={story.publishedAt}>
                  {new Date(story.publishedAt).toLocaleString("hu-HU", {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })}
                </time>
                {story.isDeveloping ? (
                  <span className="badge badge--developing">Élő sztori</span>
                ) : null}
                {!story.isAiGenerated ? (
                  <span className="badge badge--not-ai">Nem AI-fordított</span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
      )}

      <p>
        <Link href="/impresszum">Impresszum</Link>
      </p>
    </main>
  );
}
