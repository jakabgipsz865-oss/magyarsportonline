import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { facts } from "../schema/index";

export type Fact = typeof facts.$inferSelect;
export type NewFact = typeof facts.$inferInsert;

/** Bounded-context repository for the Fact Verification Agent (docs/architecture/02-agents.md §2.4). */
export class FactRepository {
  constructor(private readonly db: Database) {}

  async insertMany(rows: NewFact[]): Promise<Fact[]> {
    if (rows.length === 0) {
      return [];
    }
    return this.db.insert(facts).values(rows).returning();
  }

  async listByStoryId(storyId: string): Promise<Fact[]> {
    return this.db.select().from(facts).where(eq(facts.storyId, storyId));
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
