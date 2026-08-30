import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { deduplication } from "@magyarsportonline/agents";
import { publicCredibilityRating } from "@magyarsportonline/shared";
import { MediaThumb } from "../../../components/media-thumb";
import { StoryRiver } from "../../../components/story-river";
import { createRepositories } from "../../../lib/db";
import { env } from "../../../lib/env";
import { entitySlug } from "../../../lib/entity-slug";
import { pickRelatedStories } from "../../../lib/related-stories";
import { toStoryDetailView, toStorySummaryView } from "../../../lib/story-view";

const { matchPrimaryEntity } = deduplication;

// Story updates stay near-real-time while repeat readers avoid rebuilding the
// same read-model projection on every request.
export const revalidate = 10;

// No build-time DB scan: each slug is generated and cached on first request.
export function generateStaticParams(): Array<{ slug: string }> {
  return [];
}

const RELATED_CANDIDATES_LIMIT = 20;

interface PageProps {
  params: Promise<{ slug: string }>;
}

const loadStory = cache(async (slug: string) => {
  const { storyReadModelRepository } = createRepositories();
  const row = await storyReadModelRepository.getBySlug(slug);
  return row ? toStoryDetailView(row) : null;
});

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { slug } = await params;
  const story = await loadStory(slug);
  if (!story) {
    return {};
  }
  return {
    title: story.title,
    description: story.metaDescription ?? story.lead,
    alternates: { canonical: `/hir/${story.slug}` },
    openGraph: {
      type: "article",
      title: story.title,
      description: story.metaDescription ?? story.lead,
      url: `/hir/${story.slug}`,
      publishedTime: story.publishedAt,
      modifiedTime: story.lastUpdatedAt,
      locale: "hu_HU",
      ...(story.imageUrl ? { images: [{ url: story.imageUrl }] } : {}),
    },
  };
}

/**
 * schema.org NewsArticle strukturált adat (SEO, docs/architecture/08-roadmap.md
 * Fázis 8). A `<` escape-elése kötelező: a kimenet <script> tagbe kerül, és a
 * forrásból/LLM-ből érkező szöveg elvben tartalmazhatna "</script>"-et (XSS).
 */
function newsArticleJsonLd(story: NonNullable<Awaited<ReturnType<typeof loadStory>>>): string {
  return jsonLdStringify({
    "@context": "https://schema.org",
    "@type": "NewsArticle",
    headline: story.title,
    description: story.metaDescription ?? story.lead,
    datePublished: story.publishedAt,
    dateModified: story.lastUpdatedAt,
    inLanguage: "hu",
    isAccessibleForFree: true,
    mainEntityOfPage: `${env.SITE_URL}/hir/${story.slug}`,
    ...(story.imageUrl ? { image: story.imageUrl } : {}),
    publisher: {
      "@type": "Organization",
      name: "MagyarSportOnline",
      url: env.SITE_URL,
    },
  });
}

function jsonLdStringify(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
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

  const { storyReadModelRepository, entityRepository } = createRepositories();
  const [candidateRows, entities] = await Promise.all([
    storyReadModelRepository.listPublished({ limit: RELATED_CANDIDATES_LIMIT, offset: 0 }),
    entityRepository.listAll(),
  ]);
  const candidates = candidateRows.map(toStorySummaryView);
  const related = pickRelatedStories(story, candidates, entities);
  const primaryEntityMatch = matchPrimaryEntity(`${story.title} ${story.lead}`, entities);
  const primaryEntity = primaryEntityMatch
    ? (entities.find((entity) => entity.id === primaryEntityMatch.entityId) ?? null)
    : null;
  const independentCorroborationCount = Math.min(
    Math.max(0, story.sources.length - 1),
    Math.max(0, (story.credibility?.corroboratingSourceCount ?? 0) - 1),
  );
  const publicCredibility = story.credibility
    ? publicCredibilityRating({
        officialConfirmed: story.credibility.officialConfirmed,
        sourceReliabilityTiers: story.sources.flatMap((source) =>
          source.reliabilityTier ? [source.reliabilityTier] : [],
        ),
        independentCorroborationCount,
        hasContradiction: story.credibility.contradictions.length > 0,
      })
    : null;
  const reliabilityLabel = story.sources.some((source) => source.reliabilityTier === "A")
    ? "erős"
    : story.sources.some((source) => source.reliabilityTier === "B")
      ? "közepes"
      : story.sources.some((source) => source.reliabilityTier === "C")
        ? "korlátozott"
        : "nincs besorolva";

  return (
    <main className="public-surface">
      {/* biztonságos: newsArticleJsonLd kimenete JSON.stringify-jal épül, nem nyers string-összefűzéssel */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: newsArticleJsonLd(story) }}
      />
      <Link href="/" className="back-link">
        ← Vissza a főoldalra
      </Link>
      <div className="story-layout">
        <div className="story-main">
          <article className="story-article">
            <span className="kicker">
              Labdarúgás{primaryEntity ? " · " + primaryEntity.nameHu : ""}
            </span>
            {!story.isAiGenerated && (
              <p className="not-ai-notice" role="note">
                ⚠ Nem AI-fordított tartalom — az eredeti, angol nyelvű forrásszöveg jelenik meg
                változatlanul.
              </p>
            )}
            <h1>{story.title}</h1>
            <p className="story-article__lead">{story.lead}</p>
            {story.sources.length === 1 && story.sources[0] ? (
              <p className="story-article__source">
                <strong>Forrás:</strong>{" "}
                <a href={story.sources[0].url} target="_blank" rel="noreferrer">
                  {story.sources[0].name}
                </a>
              </p>
            ) : null}
            <div className="story-article__hero">
              <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
            </div>
            {/* biztonságos: story.bodyHtml a projector (packages/agents/read-model-projector) HTML-escape-elt kimenete */}
            <div
              className="story-article__body"
              dangerouslySetInnerHTML={{ __html: story.bodyHtml }}
            />
          </article>

          {story.versionHistory.length > 1 && (
            <section className="story-section">
              <h2>Frissítések</h2>
              <ul className="version-history">
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

          {story.isDeveloping ? <p className="story-footer-meta">Ez a sztori még alakul.</p> : null}

          {primaryEntity ? (
            <p className="story-footer-meta">
              <Link href={"/csapat/" + entitySlug(primaryEntity)}>
                Több hír: {primaryEntity.nameHu}
              </Link>
            </p>
          ) : null}
        </div>

        <aside className="story-sidebar" aria-label="A hír kiegészítő információi">
          {publicCredibility && story.credibility ? (
            <section
              className={
                "story-section story-credibility story-credibility--" + publicCredibility.slug
              }
            >
              <h2>Hitelesség</h2>
              <p className="story-credibility__rating">
                <span>{publicCredibility.level}/5</span>
                <strong>{publicCredibility.labelHu}</strong>
              </p>
              <ul className="story-credibility__meta">
                <li>Forrás megbízhatósága: {reliabilityLabel}</li>
                <li>Független megerősítő forrás: {independentCorroborationCount}</li>
                <li>
                  Hivatalos megerősítés: {story.credibility.officialConfirmed ? "igen" : "nem"}
                </li>
              </ul>

              {story.credibility.contradictions.map((contradiction) => (
                <div className="story-credibility__contradiction" key={contradiction.factType}>
                  <p>
                    <strong>⚠ Ellentmondás — {contradiction.factTypeLabelHu}:</strong>
                  </p>
                  <ul>
                    {contradiction.claims.map((claim) => (
                      <li key={claim.sourceName}>
                        {claim.sourceName} szerint: {claim.detailHu}
                      </li>
                    ))}
                  </ul>
                  <p>
                    <strong>Jelenlegi állapot:</strong> {contradiction.statusHu}
                  </p>
                </div>
              ))}
            </section>
          ) : null}

          <section className="story-section">
            <h2>Források ({story.sources.length})</h2>
            <ul className="story-sources">
              {story.sources.map((source) => (
                <li key={source.url}>
                  <a href={source.url} target="_blank" rel="noreferrer">
                    {source.name}
                  </a>
                </li>
              ))}
            </ul>
          </section>

          {related.length > 0 ? (
            <section className="story-section story-related">
              <h2>Kapcsolódó hírek</h2>
              <StoryRiver stories={related.slice(0, 3)} />
            </section>
          ) : null}
        </aside>
      </div>
    </main>
  );
}
