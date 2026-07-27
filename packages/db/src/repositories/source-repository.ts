import { eq } from "drizzle-orm";
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

  async listActive(): Promise<Source[]> {
    return this.db.select().from(sources).where(eq(sources.isActive, true));
  }

  async getById(id: string): Promise<Source | null> {
    const [row] = await this.db.select().from(sources).where(eq(sources.id, id)).limit(1);
    return row ?? null;
  }

  async recordFetchResult(
    sourceId: string,
    result: { status: "ok" | "error"; fetchedAt?: Date },
  ): Promise<void> {
    await this.db
      .update(sources)
      .set({
        lastFetchStatus: result.status,
        lastFetchedAt: result.fetchedAt ?? new Date(),
      })
      .where(eq(sources.id, sourceId));
  }
}
