import Link from "next/link";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { MediaThumb } from "../components/media-thumb";
import { SiteFooter } from "../components/site-footer";
import { D1StoryReadModelRepository } from "@magyarsportonline/db/d1";
import { createPublicRepositories, d1Binding } from "../lib/db";
import { toStorySummaryView, type StorySummaryView } from "../lib/story-view";
import { pickTrending } from "../lib/trending";
import { readTrendingSnapshot } from "../lib/trending-store";

// Read public D1 data at request time; no database access is needed at build time.
export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  alternates: { canonical: "/" },
  openGraph: { url: "/", siteName: "MSO24" },
};

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
    <Link href={`/hir/${story.slug}`} className="home-news-card" data-read-source="latest">
      <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
      <div className="home-news-card__body">
        <span className="home-kicker">Futballhírek</span>
        <h3>{story.title}</h3>
        <StoryMeta story={story} />
      </div>
    </Link>
  );
}

async function loadTrending(): Promise<{
  hero: StorySummaryView | null;
  side: StorySummaryView[];
  topFive: StorySummaryView[];
}> {
  const fallback = { hero: null, side: [], topFive: [] };
  const db = d1Binding();
  if (!db) return fallback;
  try {
    const selection = pickTrending(await readTrendingSnapshot(db), new Date());
    if (!selection.heroId) return fallback;
    const ids = [selection.heroId, ...selection.sideIds, ...selection.topFiveIds];
    const rows = await new D1StoryReadModelRepository(db).listPublishedByIds(ids);
    const byId = new Map(rows.map((row) => [row.storyId, toStorySummaryView(row)]));
    const hero = byId.get(selection.heroId);
    if (!hero) return fallback; // withdrawn or unlisted since the last snapshot
    return {
      hero,
      side: selection.sideIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []),
      topFive: selection.topFiveIds.flatMap((id) => byId.get(id) ? [byId.get(id)!] : []),
    };
  } catch {
    // Analytics must never prevent the normal chronological homepage.
    return fallback;
  }
}

function RankedList({ stories, source, className }: {
  stories: StorySummaryView[];
  source: "trending_side" | "top5";
  className: string;
}): ReactNode {
  return (
    <ol className={className}>
      {stories.map((story, index) => (
        <li key={story.id}>
          <Link href={`/hir/${story.slug}`} data-read-source={source}
            aria-label={`${index + 1}. ${story.title}`}>
            <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
            <span className="home-rank-copy">
              <strong>{story.title}</strong>
              <StoryMeta story={story} />
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}

export default async function HomePage(): Promise<ReactNode> {
  const { storyReadModelRepository } = createPublicRepositories();
  const [rows, trending] = await Promise.all([
    storyReadModelRepository.listPublished({ limit: HOMEPAGE_STORY_LIMIT, offset: 0 }),
    loadTrending(),
  ]);
  const stories = rows.map(toStorySummaryView);
  const hero = trending.hero ?? stories[0];
  const featured = stories.filter((story) => story.id !== hero?.id).slice(0, 3);

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
          <Link href={`/hir/${hero.slug}`} className="home-hero"
            data-read-source={trending.hero ? "trending_hero" : "latest"}>
            <MediaThumb imageUrl={hero.imageUrl} title={hero.title} seed={hero.id} priority />
            <div className="home-hero__content">
              <span className="home-kicker home-kicker--solid">
                {trending.hero ? <><span className="home-live-dot" aria-hidden="true" /> NÉPSZERŰ MOST</> : "Top hír"}
              </span>
              <h2>{hero.title}</h2>
              <p>{hero.lead}</p>
              <StoryMeta story={hero} />
              {trending.hero ? <span className="home-activity-note">Olvasói aktivitás alapján</span> : null}
            </div>
          </Link>

          {trending.side.length === 3 ? (
            <aside className="home-trending-side" aria-label="Most pörgő hírek">
              <h2>MOST PÖRÖG</h2>
              <RankedList stories={trending.side} source="trending_side" className="home-rank-list" />
            </aside>
          ) : (
            <div className="home-featured-stack">
              {featured.map((story) => (
                <Link key={story.id} href={`/hir/${story.slug}`} className="home-featured-card" data-read-source="latest">
                  <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
                  <div>
                    <h3>{story.title}</h3>
                    <StoryMeta story={story} />
                  </div>
                </Link>
              ))}
            </div>
          )}
        </section>

        <section id="friss-hirek" className="home-news-section">
          <div className="home-section-title home-section-title--line">
            <h2>Legfrissebb futballhírek</h2>
            <Link href="/kategoria/labdarugas">Összes futballhír →</Link>
          </div>
          <div className="home-news-grid">
            {stories.slice(0, 6).map((story) => (
              <NewsCard key={story.id} story={story} />
            ))}
          </div>
        </section>
        {trending.topFive.length === 5 ? (
          <section className="home-top-five" aria-labelledby="home-top-five-title">
            <div className="home-top-five__heading">
              <span className="home-kicker">Olvasói aktivitás alapján</span>
              <h2 id="home-top-five-title">MOST EZT OLVASSÁK</h2>
            </div>
            <RankedList stories={trending.topFive} source="top5" className="home-rank-list home-rank-list--five" />
          </section>
        ) : null}
        {stories.length > 6 ? (
          <section className="home-news-section">
            <div className="home-section-title home-section-title--line">
              <h2>További friss cikkek</h2>
            </div>
            <div className="home-news-grid">
              {stories.slice(6).map((story) => (
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
