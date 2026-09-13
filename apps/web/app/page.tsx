import Link from "next/link";
import type { ReactNode } from "react";
import { MediaThumb } from "../components/media-thumb";
import { SiteFooter } from "../components/site-footer";
import { createRepositories } from "../lib/db";
import { toStorySummaryView, type StorySummaryView } from "../lib/story-view";

// Render against Hyperdrive at request time. This keeps deployment builds
// independent from production database credentials and avoids relying on an
// R2 incremental cache before R2 is enabled for the Cloudflare account.
export const dynamic = "force-dynamic";

const HOMEPAGE_STORY_LIMIT = 24;

function timeAgo(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  return `${Math.round(hours / 24)} napja`;
}

function StoryMeta({ story }: { story: StorySummaryView }): ReactNode {
  return (
    <div className="home-story-meta">
      <span>{story.primarySourceName ?? "Forrás"}</span>
      <span aria-hidden="true">•</span>
      <time dateTime={story.publishedAt}>{timeAgo(story.publishedAt)}</time>
    </div>
  );
}

function NewsCard({ story }: { story: StorySummaryView }): ReactNode {
  return (
    <Link href={`/hir/${story.slug}`} className="home-news-card">
      <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
      <div className="home-news-card__body">
        <span className="home-kicker">Futballhírek</span>
        <h3>{story.title}</h3>
        <StoryMeta story={story} />
      </div>
    </Link>
  );
}

export default async function HomePage(): Promise<ReactNode> {
  const { storyReadModelRepository } = createRepositories();
  const rows = await storyReadModelRepository.listPublished({
    limit: HOMEPAGE_STORY_LIMIT,
    offset: 0,
  });
  const stories = rows.map(toStorySummaryView);
  const [hero, ...latest] = stories;
  const featured = latest.slice(0, 3);

  if (!hero) {
    return (
      <div className="home-redesign public-surface">
        <main className="home-main">
          <h1 className="sr-only">Friss futballhírek</h1>
          <div className="home-empty-grid home-empty-grid--tabloid">
            <section className="home-empty" aria-labelledby="home-empty-title">
              <span className="home-empty__eyebrow">Futballhírek</span>
              <h2 id="home-empty-title">Hamarosan friss futballhírekkel jelentkezünk</h2>
              <p>Futball, személyes történetek és pályán kívüli események.</p>
            </section>
          </div>
          <SiteFooter className="home-footer" />
        </main>
      </div>
    );
  }

  return (
    <div className="home-redesign public-surface">
      <main className="home-main">
        <h1 className="sr-only">Friss futballhírek</h1>
        <section className="home-hero-layout home-hero-layout--tabloid" aria-label="Kiemelt hírek">
          <Link href={`/hir/${hero.slug}`} className="home-hero">
            <MediaThumb imageUrl={hero.imageUrl} title={hero.title} seed={hero.id} />
            <div className="home-hero__content">
              <span className="home-kicker home-kicker--solid">Top hír</span>
              <h2>{hero.title}</h2>
              <p>{hero.lead}</p>
              <StoryMeta story={hero} />
            </div>
          </Link>

          <div className="home-featured-stack">
            {featured.slice(0, 3).map((story) => (
              <Link key={story.id} href={`/hir/${story.slug}`} className="home-featured-card">
                <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
                <div>
                  <h3>{story.title}</h3>
                  <StoryMeta story={story} />
                </div>
              </Link>
            ))}
          </div>
        </section>

        <section id="friss-hirek" className="home-news-section">
          <div className="home-section-title home-section-title--line">
            <h2>Friss futballhírek</h2>
            <Link href="/kategoria/labdarugas">Összes futballhír →</Link>
          </div>
          <div className="home-news-grid">
            {latest.slice(3, 12).map((story) => (
              <NewsCard key={story.id} story={story} />
            ))}
          </div>
        </section>
        {latest.length > 12 ? (
          <section className="home-news-section">
            <div className="home-section-title home-section-title--line">
              <h2>További legfrissebb cikkek</h2>
            </div>
            <div className="home-news-grid">
              {latest.slice(12).map((story) => (
                <NewsCard key={story.id} story={story} />
              ))}
            </div>
          </section>
        ) : null}

        <SiteFooter className="home-footer" />
      </main>
    </div>
  );
}
