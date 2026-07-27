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
      <h1>magyarsportonline.hu</h1>
      <p>
        AI-first, Story-alapú sporthír-platform — a repository <code>docs/architecture/</code>{" "}
        könyvtárában található teljes architekturális terv szerint.
      </p>

      {stories.length === 0 ? (
        <p>Még nincs publikált hír.</p>
      ) : (
        <ul>
          {stories.map((story) => (
            <li key={story.id}>
              <Link href={`/hir/${story.slug}`}>{story.title}</Link>
              {story.isDeveloping ? " (élő, alakuló sztori)" : null}
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
