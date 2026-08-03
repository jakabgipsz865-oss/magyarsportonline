import Link from "next/link";
import type { ReactNode } from "react";
import { MediaThumb } from "../components/media-thumb";
import { StoryRiver } from "../components/story-river";
import { createRepositories } from "../lib/db";
import { entitySlug } from "../lib/entity-slug";
import { buildHomepageView } from "../lib/homepage";
import { toStorySummaryView, type StorySummaryView } from "../lib/story-view";

// DB-driven, always-fresh listing — never statically prerendered at build time.
export const dynamic = "force-dynamic";

const HOMEPAGE_STORY_LIMIT = 24;

function timeAgo(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.max(1, Math.round(diffMs / 60000));
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  const days = Math.round(hours / 24);
  return `${days} napja`;
}

function StatusBadges({ story }: { story: StorySummaryView }): ReactNode {
  return (
    <>
      {story.isDeveloping ? <span className="badge badge--developing">Élő sztori</span> : null}
      {!story.isAiGenerated ? <span className="badge badge--not-ai">Nem AI-fordított</span> : null}
    </>
  );
}

export default async function HomePage(): Promise<ReactNode> {
  const { storyReadModelRepository, entityRepository } = createRepositories();
  const [rows, entities] = await Promise.all([
    storyReadModelRepository.listPublished({ limit: HOMEPAGE_STORY_LIMIT, offset: 0 }),
    entityRepository.listAll(),
  ]);
  const stories = rows.map(toStorySummaryView);
  const { ticker, hero, featured, river, popularEntities } = buildHomepageView(stories, entities);

  if (!hero) {
    return (
      <main>
        <h1 className="sr-only">Legfrissebb sporthírek</h1>
        <section className="home-empty" aria-labelledby="home-empty-title">
          <span className="home-empty__eyebrow">Automatikus szerkesztőség</span>
          <h2 id="home-empty-title">Friss sporthírek készülnek</h2>
          <p>
            Csak a forrásellenőrzésen, magyar nyelvi ellenőrzésen és quality gate-en átment
            cikkek jelennek meg. A következő hírcsomag feldolgozása folyamatban van.
          </p>
        </section>
      </main>
    );
  }

  return (
    <>
      <div className="ticker">
        <div className="ticker__inner">
          <span className="ticker__badge">ÉLŐ</span>
          {ticker.map((story, index) => (
            <span key={story.id} className="ticker__item">
              <Link href={`/hir/${story.slug}`}>{story.title}</Link>
              {index < ticker.length - 1 ? <span className="ticker__sep"> · </span> : null}
            </span>
          ))}
        </div>
      </div>

      <main>
        <h1 className="sr-only">Legfrissebb sporthírek</h1>
        <div className="home-layout">
          <div>
            <Link href={`/hir/${hero.slug}`} className="hero-card">
              <MediaThumb imageUrl={hero.imageUrl} title={hero.title} seed={hero.id} />
              <div className="hero-card__body">
                <span className="kicker">Top Story</span>
                <h2 className="hero-card__title">{hero.title}</h2>
                <p className="hero-card__lead">{hero.lead}</p>
                <div className="item-meta">
                  <span>BBC Sport</span>
                  <span className="dot" />
                  <span>{timeAgo(hero.publishedAt)}</span>
                  <StatusBadges story={hero} />
                </div>
              </div>
            </Link>

            {featured.length > 0 ? (
              <ul className="featured-list">
                {featured.map((story) => (
                  <li key={story.id} className="featured-card">
                    <Link href={`/hir/${story.slug}`} style={{ display: "contents" }}>
                      <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
                      <div>
                        <h3 className="featured-card__title">{story.title}</h3>
                        <div className="item-meta">
                          <span>{timeAgo(story.publishedAt)}</span>
                          <StatusBadges story={story} />
                        </div>
                      </div>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}

            {river.length > 0 ? (
              <>
                <h2 className="river-heading">Legfrissebb</h2>
                <StoryRiver stories={river} />
              </>
            ) : null}
          </div>

          <aside className="side">
            <div className="panel">
              <div className="panel__h">Kategóriák</div>
              <div className="chip-list">
                <Link href="/kategoria/labdarugas" className="chip">
                  Labdarúgás
                </Link>
              </div>
            </div>
            {popularEntities.length > 0 ? (
              <div className="panel">
                <div className="panel__h">Csapatok &amp; bajnokságok</div>
                <div className="chip-list">
                  {popularEntities.map((entity) => (
                    <Link key={entity.id} href={`/csapat/${entitySlug(entity)}`} className="chip">
                      {entity.nameHu}
                    </Link>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>
        </div>

        <footer className="site-footer">
          <span>© MagyarSportOnline</span>
          <span>
            <Link href="/impresszum">Impresszum</Link> · Források: BBC Sport
          </span>
        </footer>
      </main>
    </>
  );
}
