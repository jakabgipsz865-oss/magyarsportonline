import type { SourceCategory, SourceReliabilityTier } from "@magyarsportonline/shared";
import { and, eq } from "drizzle-orm";
import type { Database } from "../client";
import { facts, rawArticles, sources, storySources } from "../schema/index";

export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;

/**
 * Egy Fact + az őt eredményező forrás metaadata (2026-07-28-i "Hitelesség-
 * magyarázat" bővítés, packages/agents/src/fact-verification/
 * credibility-explanation.ts) — a publikus oldal és a bizonyító riport
 * "melyik forrás mit állított" nézetéhez.
 */
export interface FactWithSourceInfo {
  id: string;
  factType: Fact["factType"];
  payload: unknown;
  isContradicted: boolean;
  corroborationCount: number;
  sourceId: string;
  sourceName: string;
  category: SourceCategory | null;
  reliabilityTier: SourceReliabilityTier;
  trustBaseline: number | null;
}

/** Bounded-context repository for the Fact Verification Agent (docs/architecture/02-agents.md §2.4). */
export class FactRepository {
  constructor(private readonly db: Database) {}

  async insertMany(rows: NewFact[]): Promise<Fact[]> {
    if (rows.length === 0) {
      return [];
    }
    return this.db.insert(facts).values(rows).returning();
  }

  /**
   * Atomically replaces the derived Fact set for a Story after a complete
   * successful extraction pass. Provider failures happen before this call,
   * so the previous verified facts remain intact and the durable job can
   * retry; a successful regeneration cannot leave stale fallback facts
   * mixed with the new Hungarian facts.
   */
  async replaceForStory(storyId: string, rows: NewFact[]): Promise<Fact[]> {
    return this.db.transaction(async (tx) => {
      await tx.delete(facts).where(eq(facts.storyId, storyId));
      if (rows.length === 0) {
        return [];
      }
      return tx.insert(facts).values(rows).returning();
    });
  }

  async listByStoryId(storyId: string): Promise<Fact[]> {
    return this.db.select().from(facts).where(eq(facts.storyId, storyId));
  }

  /**
   * Facts joined with the originating source's name/category/reliability
   * (2026-07-28-i "Hitelesség-magyarázat" bővítés) — kizárja a kizárt
   * (`excluded=true`) állításokat ÉS azokat, amiknek a forrás-kapcsolata
   * admin által ki lett zárva (`story_sources.excluded=true`), mert ezek
   * a publikus/riport megjelenítésben sem szerepelhetnek.
   */
  async listByStoryIdWithSourceName(storyId: string): Promise<FactWithSourceInfo[]> {
    const rows = await this.db
      .select({
        id: facts.id,
        factType: facts.factType,
        payload: facts.payload,
        isContradicted: facts.isContradicted,
        corroborationCount: facts.corroborationCount,
        sourceId: sources.id,
        sourceName: sources.name,
        category: sources.category,
        reliabilityTier: sources.reliabilityTier,
        trustBaseline: sources.trustBaseline,
      })
      .from(facts)
      .innerJoin(rawArticles, eq(facts.rawArticleId, rawArticles.id))
      .innerJoin(sources, eq(rawArticles.sourceId, sources.id))
      .innerJoin(
        storySources,
        and(
          eq(storySources.rawArticleId, facts.rawArticleId),
          eq(storySources.storyId, facts.storyId),
        ),
      )
      .where(
        and(
          eq(facts.storyId, storyId),
          eq(facts.excluded, false),
          eq(storySources.excluded, false),
        ),
      );
    return rows;
  }

  async markContradicted(factId: string): Promise<void> {
    await this.db.update(facts).set({ isContradicted: true }).where(eq(facts.id, factId));
  }

  async bumpCorroboration(factId: string, corroborationCount: number): Promise<void> {
    await this.db.update(facts).set({ corroborationCount }).where(eq(facts.id, factId));
  }

  /** Admin claim-szerkeszthetőség (2026-07-28) — egy állítás kizárása a hitelesség-számításból, indoklással. */
  async setExcluded(factId: string, excluded: boolean, reason: string | null): Promise<void> {
    await this.db
      .update(facts)
      .set({ excluded, excludedReason: excluded ? reason : null })
      .where(eq(facts.id, factId));
  }

  /** Admin claim-szerkeszthetőség (2026-07-28) — egy állítás magyar szövegének (payload.detail_hu) javítása. */
  async updateDetail(factId: string, detailHu: string): Promise<void> {
    const [existing] = await this.db.select().from(facts).where(eq(facts.id, factId)).limit(1);
    if (!existing) {
      throw new Error(`Fact "${factId}" not found`);
    }
    const payload =
      typeof existing.payload === "object" && existing.payload !== null
        ? (existing.payload as Record<string, unknown>)
        : {};
    await this.db
      .update(facts)
      .set({ payload: { ...payload, detail_hu: detailHu } })
      .where(eq(facts.id, factId));
  }
}
