import { jsonb, pgTable, text, timestamp, uuid, vector, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import type { SourceInlineImage } from "@magyarsportonline/shared";
import { ingestStatusEnum } from "./enums";
import { sources } from "./sources";
import { stories } from "./stories";

/**
 * Embedding dimenzió: 1536. Ez egy Fázis 0-ban rögzített, egyszerű és
 * könnyen visszafordítható választás (nincs még kiválasztott embedding
 * modell — az a Fázis 4, Deduplication Agent döntése) — lásd
 * docs/adr/0002-embedding-vector-dimensions.md. Mivel a Fázis 0-ban még
 * nincs éles adat, a dimenzió later migrációval változtatható.
 */
export const RAW_ARTICLE_EMBEDDING_DIMENSIONS = 1536;

export const rawArticles = pgTable(
  "raw_articles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    sourceId: uuid("source_id")
      .notNull()
      .references(() => sources.id),
    sourceUrl: text("source_url").notNull(),
    titleOriginal: text("title_original").notNull(),
    // Source Fetcher (2026-07-28-i sprint, packages/agents/src/source-ingest/
    // article-fetcher/): teljes cikk letöltésekor a forrás-specifikus
    // extractor tölti ki, ha talál ilyet — RSS-only cikkeknél mindig null.
    subtitleOriginal: text("subtitle_original"),
    bodyOriginal: text("body_original").notNull(),
    // Provenance is explicit so an RSS description cannot be mistaken for a
    // successfully fetched full source article at publication time.
    contentOrigin: text("content_origin").notNull().default("rss_snippet"),
    authorOriginal: text("author_original"),
    // RSS media:thumbnail/enclosure image, if the source provided one — frontend
    // hero/thumbnail display (Real Sports Portal UX sprint). Never re-hosted,
    // just the source URL.
    imageUrl: text("image_url"),
    // Publisher-hosted images that appeared inside the RSS article body.
    // URLs are embedded directly on the public article; image files are never copied.
    inlineImages: jsonb("inline_images").$type<SourceInlineImage[]>().notNull().default([]),
    language: text("language").notNull(),
    embedding: vector("embedding", {
      dimensions: RAW_ARTICLE_EMBEDDING_DIMENSIONS,
    }),
    extractedEntities: jsonb("extracted_entities"),
    ingestStatus: ingestStatusEnum("ingest_status").notNull().default("ingested"),
    storyId: uuid("story_id").references(() => stories.id),
    publishedAtSource: timestamp("published_at_source", { withTimezone: true }),
    ingestedAt: timestamp("ingested_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    uniqueIndex("raw_articles_source_url_unique").on(table.sourceId, table.sourceUrl),
    uniqueIndex("raw_articles_source_guid_unique").on(
      table.sourceId,
      sql`(${table.extractedEntities}->>'rssGuid')`,
    ),
  ],
);
