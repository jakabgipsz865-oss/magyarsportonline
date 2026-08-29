import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cache, type ReactNode } from "react";
import { deduplication } from "@magyarsportonline/agents";
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
  const sourceUrlByName = new Map(story.sources.map((source) => [source.name, source.url]));

  return (
    <main>
      {/* biztonságos: newsArticleJsonLd kimenete JSON.stringify-jal épül, nem nyers string-összefűzéssel */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: newsArticleJsonLd(story) }}
      />
      <Link href="/" className="back-link">
        ← Vissza a főoldalra
      </Link>
      <article className="story-article">
        <span className="kicker">
          Labdarúgás{primaryEntity ? ` · ${primaryEntity.nameHu}` : ""}
        </span>
        {!story.isAiGenerated && (
          <p className="not-ai-notice" role="note">
            ⚠ Nem AI-fordított tartalom — az eredeti, angol nyelvű forrásszöveg jelenik meg
            változatlanul.
          </p>
        )}
        <h1>{story.title}</h1>
        <p className="story-article__lead">{story.lead}</p>
        <div className="story-article__hero">
          <MediaThumb imageUrl={story.imageUrl} title={story.title} seed={story.id} />
        </div>
        {/* biztonságos: story.bodyHtml a projector (packages/agents/read-model-projector) HTML-escape-elt kimenete */}
        <div className="story-article__body" dangerouslySetInnerHTML={{ __html: story.bodyHtml }} />
      </article>

      <section className="story-section">
        <h2>Források ({story.sources.length})</h2>
        <ul className="story-sources">
          {story.sources.map((source) => (
            <li key={source.url}>
              <a href={source.url} target="_blank" rel="noreferrer">
                {source.name}
              </a>
              {source.reliabilityTier ? (
                <span className="story-sources__tier">
                  {" "}
                  · {source.reliabilityTier} megbízhatóság
                </span>
              ) : null}
            </li>
          ))}
        </ul>
      </section>

      {story.credibility && (
        <section className="story-section story-credibility">
          <h2>Hitelesség: {story.credibility.score}/100</h2>
          <p className="story-credibility__band">
            <strong>{story.credibility.labelHu ?? "Nincs értékelve"}</strong>
          </p>
          {story.credibility.justificationHu ? <p>{story.credibility.justificationHu}</p> : null}

          {story.credibility.sourceBreakdown.length > 0 && (
            <div className="story-credibility__source-breakdown">
              <h3>Források</h3>
              <ul>
                {story.credibility.sourceBreakdown.map((item) => {
                  const url = sourceUrlByName.get(item.name);
                  return (
                    <li key={item.sourceId}>
                      <span className="story-credibility__source-name">
                        {item.badgeEmoji}{" "}
                        {url ? (
                          <a href={url} target="_blank" rel="noreferrer">
                            {item.name}
                          </a>
                        ) : (
                          item.name
                        )}
                      </span>
                      <br />
                      Megbízhatóság: {item.reliabilityDisplayScore}
                      <br />
                      {item.factCountLabelHu}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}

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

          <ul className="story-credibility__meta">
            <li>
              {story.credibility.corroboratingSourceCount ?? 0} megerősítő forrás a legjobban
              alátámasztott állításra
            </li>
            <li>Hivatalos megerősítés: {story.credibility.officialConfirmed ? "igen" : "nem"}</li>
            {story.credibility.updatedAt ? (
              <li>
                Utolsó frissítés:{" "}
                <time dateTime={story.credibility.updatedAt}>
                  {new Date(story.credibility.updatedAt).toLocaleString("hu-HU")}
                </time>
              </li>
            ) : null}
          </ul>

          {story.credibility.scoreBreakdown.length > 0 && (
            <details className="story-credibility__score-breakdown">
              <summary>Miért ennyi a pontszám?</summary>
              <ul>
                {story.credibility.scoreBreakdown.map((entry, index) => (
                  <li key={`${entry.labelHu}-${index}`}>
                    {entry.points > 0 ? `+${entry.points}` : entry.points} — {entry.labelHu}
                  </li>
                ))}
              </ul>
            </details>
          )}

          {story.credibility.history.length > 1 && (
            <details className="story-credibility__history">
              <summary>Hitelességi változások története</summary>
              <ul>
                {story.credibility.history.map((entry, index) => (
                  <li key={`${entry.recordedAt}-${index}`}>
                    <time dateTime={entry.recordedAt}>
                      {new Date(entry.recordedAt).toLocaleString("hu-HU")}
                    </time>
                    {" — "}
                    {entry.labelHu} ({entry.score}/100)
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

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

      {related.length > 0 ? (
        <section className="story-section">
          <h2>Kapcsolódó hírek</h2>
          <StoryRiver stories={related} />
        </section>
      ) : null}

      <p className="story-footer-meta">
        Megbízhatósági pontszám:{" "}
        {story.confidenceScore !== null ? story.confidenceScore.toFixed(2) : "n/a"}
        {story.isDeveloping ? " · Ez a sztori még alakul." : null}
      </p>

      {primaryEntity ? (
        <p className="story-footer-meta">
          <Link href={`/csapat/${entitySlug(primaryEntity)}`}>
            Több hír: {primaryEntity.nameHu}
          </Link>
        </p>
      ) : null}
    </main>
  );
}
