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
}
