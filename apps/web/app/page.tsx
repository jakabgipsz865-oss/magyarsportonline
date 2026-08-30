import Link from "next/link";
import type { ReactNode } from "react";
import { MediaThumb } from "../components/media-thumb";
import { createRepositories } from "../lib/db";
import { entitySlug } from "../lib/entity-slug";
import { buildHomepageView } from "../lib/homepage";
import {
  getPremierLeaguePanel,
  type PremierLeagueMatch,
  type PremierLeaguePanel,
} from "../lib/premier-league-fixtures";
import { toStorySummaryView, type StorySummaryView } from "../lib/story-view";

export const revalidate = 10;

const HOMEPAGE_STORY_LIMIT = 24;

function timeAgo(iso: string): string {
  const minutes = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (minutes < 60) return `${minutes} perce`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} órája`;
  return `${Math.round(hours / 24)} napja`;
}

function CredibilityBadge({ story }: { story: StorySummaryView }): ReactNode {
  if (!story.credibilityLevel) return null;
  return (
    <span
      className={`home-credibility home-credibility--${story.credibilityLevel}`}
      title={story.credibilityLabel ?? undefined}
    >
      {story.credibilityLevel}/5
    </span>
  );
}

function StoryMeta({ story }: { story: StorySummaryView }): ReactNode {
  return (
    <div className="home-story-meta">
      <span>{story.primarySourceName ?? "Forrás"}</span>
      <span aria-hidden="true">•</span>
      <time dateTime={story.publishedAt}>{timeAgo(story.publishedAt)}</time>
      <CredibilityBadge story={story} />
    </div>
  );
}

function NewsCard({ story }: { story: StorySummaryView }): ReactNode {
  return (
    <Link href={`/hir/${story.slug}`} className="home-news-card">
      <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
      <div className="home-news-card__body">
        <span className="home-kicker">Labdarúgás</span>
        <h3>{story.title}</h3>
        <StoryMeta story={story} />
      </div>
    </Link>
  );
}

function matchStatus(match: PremierLeagueMatch): string {
  if (match.isLive) return `LIVE${match.elapsed ? ` ${match.elapsed}'` : ""}`;
  if (["FT", "AET", "PEN"].includes(match.statusShort)) return "VÉGE";
  if (match.statusShort === "NS") {
    return new Date(match.kickoffUtc).toLocaleTimeString("hu-HU", {
      timeZone: "Europe/Budapest",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  return match.statusLong;
}

function MatchPanel({ panel }: { panel: PremierLeaguePanel }): ReactNode {
  return (
    <section className="home-panel home-match-panel" aria-labelledby="pl-matches-title">
      <div className="home-section-title">
        <span aria-hidden="true">⚽</span>
        <h2 id="pl-matches-title">{panel.title}</h2>
      </div>
      {panel.state === "missing_key" ? (
        <p className="home-panel__notice">API_FOOTBALL_KEY REQUIRED</p>
      ) : panel.state === "unavailable" ? (
        <p className="home-panel__notice">A meccsadatok átmenetileg nem érhetők el.</p>
      ) : panel.matches.length === 0 ? (
        <p className="home-panel__notice">Nincs kiírt Premier League-meccs a következő 7 napban.</p>
      ) : (
        <ol className="match-list">
          {panel.matches.map((match) => (
            <li key={match.id} className="match-row">
              <div className={match.isLive ? "match-status match-status--live" : "match-status"}>
                {matchStatus(match)}
              </div>
              <div className="match-teams">
                <span>{match.homeTeam}</span>
                <span>{match.awayTeam}</span>
              </div>
              <div className="match-score" aria-label="Eredmény">
                <span>{match.homeGoals ?? "–"}</span>
                <span>{match.awayGoals ?? "–"}</span>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p className="match-provider">API-Football · 15 perces szerveroldali gyorsítótár</p>
    </section>
  );
}

function CredibilityScale(): ReactNode {
  const levels = [
    [5, "Hivatalosan megerősített"],
    [4, "Erős, megbízható forrás"],
    [3, "Mérsékelt bizonyosság"],
    [2, "Korlátozott bizonyosság"],
    [1, "Spekulatív"],
  ] as const;
  return (
    <section className="home-panel">
      <div className="home-section-title">
        <h2>Hitelességi skála</h2>
      </div>
      <ol className="credibility-scale">
        {levels.map(([level, label]) => (
          <li key={level}>
            <span className={`home-credibility home-credibility--${level}`}>{level}/5</span>
            <span>{label}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default async function HomePage(): Promise<ReactNode> {
  const { storyReadModelRepository, entityRepository } = createRepositories();
  const [rows, entities, matches] = await Promise.all([
    storyReadModelRepository.listPublished({
      limit: HOMEPAGE_STORY_LIMIT,
      offset: 0,
    }),
    entityRepository.listAll(),
    getPremierLeaguePanel(),
  ]);
  const stories = rows.map(toStorySummaryView);
  const { ticker, hero, featured, popularEntities } = buildHomepageView(stories, entities);
  const transferStories = stories.filter((story) =>
    /átigazol|igazolás|szerződ|transzfer/i.test(`${story.title} ${story.lead}`),
  );

  if (!hero) {
    return (
      <div className="home-redesign public-surface">
        <main className="home-main">
          <h1 className="sr-only">Legfrissebb sporthírek</h1>
          <div className="home-empty-grid">
            <section className="home-empty" aria-labelledby="home-empty-title">
              <span className="home-empty__eyebrow">Automatikus szerkesztőség</span>
              <h2 id="home-empty-title">Friss sporthírek készülnek</h2>
              <p>Csak az ellenőrzéseken átment cikkek jelennek meg.</p>
            </section>
            <MatchPanel panel={matches} />
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className="home-redesign public-surface">
      <div className="home-ticker">
        <div className="home-ticker__inner">
          <strong>ÉLŐ MOST</strong>
          {ticker.map((story) => (
            <Link key={story.id} href={`/hir/${story.slug}`}>
              {story.title}
            </Link>
          ))}
        </div>
      </div>

      <main className="home-main">
        <h1 className="sr-only">Legfrissebb sporthírek</h1>
        <section className="home-hero-layout" aria-label="Kiemelt hírek">
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

          <aside className="home-sidebar" aria-label="Premier League és friss hírek">
            <MatchPanel panel={matches} />
            <section className="home-panel home-latest-panel">
              <div className="home-section-title">
                <h2>Friss hírek</h2>
              </div>
              <ol>
                {stories.slice(0, 6).map((story) => (
                  <li key={story.id}>
                    <time dateTime={story.publishedAt}>{timeAgo(story.publishedAt)}</time>
                    <Link href={`/hir/${story.slug}`}>{story.title}</Link>
                  </li>
                ))}
              </ol>
            </section>
          </aside>
        </section>

        <div className="home-content-layout">
          <div className="home-content-main">
            <section id="friss-hirek" className="home-news-section">
              <div className="home-section-title home-section-title--line">
                <h2>Legfrissebb hírek</h2>
                <Link href="/kategoria/labdarugas">Összes hír →</Link>
              </div>
              <div className="home-news-grid">
                {stories.slice(0, 9).map((story) => (
                  <NewsCard key={story.id} story={story} />
                ))}
              </div>
            </section>

            <section id="premier-league" className="home-news-section">
              <div className="home-section-title home-section-title--line">
                <h2>Premier League</h2>
              </div>
              <div className="home-compact-grid">
                {stories.slice(0, 6).map((story) => (
                  <Link key={story.id} href={`/hir/${story.slug}`} className="home-compact-story">
                    <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
                    <div>
                      <h3>{story.title}</h3>
                      <StoryMeta story={story} />
                    </div>
                  </Link>
                ))}
              </div>
            </section>

            <section id="atigazolasok" className="home-news-section">
              <div className="home-section-title home-section-title--line">
                <h2>Átigazolások</h2>
              </div>
              {transferStories.length ? (
                <div className="home-news-grid">
                  {transferStories.slice(0, 3).map((story) => (
                    <NewsCard key={story.id} story={story} />
                  ))}
                </div>
              ) : (
                <p className="home-section-empty">Jelenleg nincs friss átigazolási hír.</p>
              )}
            </section>
          </div>

          <aside className="home-lower-sidebar">
            <CredibilityScale />
            {popularEntities.length > 0 ? (
              <section className="home-panel">
                <div className="home-section-title">
                  <h2>Csapatok</h2>
                </div>
                <div className="home-team-links">
                  {popularEntities.map((entity) => (
                    <Link key={entity.id} href={`/csapat/${entitySlug(entity)}`}>
                      {entity.nameHu}
                    </Link>
                  ))}
                </div>
              </section>
            ) : null}
          </aside>
        </div>

        <footer className="site-footer home-footer">
          <span>© MagyarSportOnline</span>
          <span>
            <Link href="/impresszum">Impresszum</Link> · Források az egyes cikkeknél
          </span>
        </footer>
      </main>
    </div>
  );
}
