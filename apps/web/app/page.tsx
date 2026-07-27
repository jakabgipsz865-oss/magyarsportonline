import type { ReactNode } from "react";
import Link from "next/link";
import { db } from "@/lib/db";
import { listPublishedStories } from "@/lib/stories";

// Lásd app/hir/[slug]/page.tsx megjegyzését — MVP-ben nincs még ISR.
export const dynamic = "force-dynamic";

function formatConfidence(score: number | null): string {
  if (score === null) return "ismeretlen";
  return `${Math.round(score * 100)}%`;
}

export default async function HomePage(): Promise<ReactNode> {
  const stories = await listPublishedStories(db);

  return (
    <main>
      <h1>magyarsportonline.hu</h1>
      <p>
        AI-first, Story-alapú sporthír-platform. A teljes architekturális terv a repository{" "}
        <code>docs/architecture/</code> könyvtárában található.
      </p>

      {stories.length === 0 ? (
        <p>
          Még nincs publikált Story. Futtasd le a <code>pnpm demo</code> parancsot a repo gyökeréből
          egy teljes RSS → Story → publikálás folyamat végigviteléhez.
        </p>
      ) : (
        <section aria-label="Legutóbbi hírek">
          <h2>Legutóbbi hírek</h2>
          <ul className="story-list">
            {stories.map((story) => (
              <li key={story.slug}>
                <Link href={`/hir/${story.slug}`}>{story.titleHu}</Link>
                <p>{story.leadHu}</p>
                <p className="story-meta">
                  Megbízhatóság: {formatConfidence(story.confidenceScore)}
                </p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <p>
        <Link href="/impresszum">Impresszum</Link>
      </p>
    </main>
  );
}
