import Link from "next/link";
import type { ReactNode } from "react";
import { MediaThumb } from "./media-thumb";
import type { StorySummaryView } from "../lib/story-view";

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  const days = Math.round(hours / 24);
  return `${days} napja`;
}

/** Shared "latest news" list markup — used by the homepage river, category/team pages, and related-stories sections. */
export function StoryRiver({ stories }: { stories: StorySummaryView[] }): ReactNode {
  if (stories.length === 0) {
    return <p className="empty-state">Ebben a témában még nincs publikált hír.</p>;
  }

  return (
    <ul className="river">
      {stories.map((story) => (
        <li key={story.id} className="river-card">
          <Link href={`/hir/${story.slug}`} style={{ display: "contents" }}>
            <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
            <div>
              <h3 className="river-card__title">{story.title}</h3>
              <p className="river-card__lead">{story.lead}</p>
              <div className="item-meta">
                <span>{timeAgo(story.publishedAt)}</span>
                {story.isDeveloping ? (
                  <span className="badge badge--developing">Élő sztori</span>
                ) : null}
                {!story.isAiGenerated ? (
                  <span className="badge badge--not-ai">Nem AI-fordított</span>
                ) : null}
              </div>
            </div>
          </Link>
        </li>
      ))}
    </ul>
  );
}
