import { eq, sql } from "drizzle-orm";
import type { Database } from "../client";
import { sources } from "../schema/index";

export type Source = typeof sources.$inferSelect;

/**
 * Narrow, Source Ingest / Fact Verification agent-facing slice of the
 * `sources` table (docs/architecture/02-agents.md §2.1, §2.4 — the latter
 * reads `reliability_tier` for the Confidence Score's source_reliability_score
 * term). Deliberately exposes only what those agents need — per
 * docs/architecture/09-architecture-review.md §4, agents get bounded-context
 * repositories, not the whole schema.
 */
export class SourceRepository {
  constructor(private readonly db: Database) {}

  /**
   * Ordered least-recently-fetched first (2026-07-29) — matters now that
   * `runSourceIngest`'s `maxNewArticlesPerRun` budget is shared across all
   * active sources in a run (packages/agents/src/source-ingest/index.ts):
   * a source skipped because an earlier source already spent the budget is
   * never fetched that run, so its `lastFetchedAt` stays unchanged and it
   * naturally sorts to the front next run. Without this ordering, whichever
   * source happens to come first would silently starve every other source
   * of the shared budget forever.
   */
  async listActive(): Promise<Source[]> {
    return this.db
      .select()
      .from(sources)
      .where(eq(sources.isActive, true))
      .orderBy(sql`${sources.lastFetchedAt} ASC NULLS FIRST`);
  }

  async getById(id: string): Promise<Source | null> {
    const [row] = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    return row ?? null;
  }

  async recordFetchResult(
    sourceId: string,
    result: { status: "ok" | "error"; fetchedAt?: Date },
  ): Promise<void> {
    const fetchedAt = result.fetchedAt ?? new Date();
    await this.db
      .update(sources)
      .set({
        lastFetchStatus: result.status,
        lastFetchedAt: fetchedAt,
        ...(result.status === "ok" ? { lastSuccessAt: fetchedAt } : { lastErrorAt: fetchedAt }),
      })
      .where(eq(sources.id, sourceId));
  }
}
