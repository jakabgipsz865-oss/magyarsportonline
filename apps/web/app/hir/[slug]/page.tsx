import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { createRepositories } from "../../../lib/db";
import { env } from "../../../lib/env";
import { toStoryDetailView } from "../../../lib/story-view";

// DB-driven, always-fresh — never statically prerendered at build time.
export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ slug: string }>;
}

async function loadStory(slug: string) {
  const { storyReadModelRepository } = createRepositories();
  const row = await storyReadModelRepository.getBySlug(slug);
  return row ? toStoryDetailView(row) : null;
}

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
    publisher: {
      "@type": "Organization",
      name: "magyarsportonline.hu",
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
        {!story.isAiGenerated && (
          <p className="not-ai-notice" role="note">
            ⚠ Nem AI-fordított tartalom — az eredeti, angol nyelvű forrásszöveg jelenik meg
            változatlanul.
          </p>
        )}
        <h1>{story.title}</h1>
        <p className="story-article__lead">{story.lead}</p>
        {/* biztonságos: story.bodyHtml a projector (packages/agents/read-model-projector) HTML-escape-elt kimenete */}
        <div className="story-article__body" dangerouslySetInnerHTML={{ __html: story.bodyHtml }} />
      </article>

      <section className="story-section">
        <h2>Források</h2>
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

      <p className="story-footer-meta">
        Megbízhatósági pontszám:{" "}
        {story.confidenceScore !== null ? story.confidenceScore.toFixed(2) : "n/a"}
        {story.isDeveloping ? " · Ez a sztori még alakul." : null}
      </p>
    </main>
  );
}
