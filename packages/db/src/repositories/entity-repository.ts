import type { Database } from "../client";
import { entities, storyEntities } from "../schema/index";

export type Entity = typeof entities.$inferSelect;

/**
 * Bounded-context repository for the Deduplication Agent's MVP alias-lookup
 * entity matching (docs/adr/0005-mvp-end-to-end-scope-cuts.md decision 3).
 */
export class EntityRepository {
  constructor(private readonly db: Database) {}

  /** Small, seeded taxonomy — loaded once per Dedup Agent run, not per-request. */
  async listAll(): Promise<Entity[]> {
    return this.db.select().from(entities);
  }

  async linkToStory(
    storyId: string,
    entityId: string,
    role: "subject" | "opponent" | "mentioned",
  ): Promise<void> {
    await this.db
      .insert(storyEntities)
      .values({ storyId, entityId, role })
      .onConflictDoNothing({ target: [storyEntities.storyId, storyEntities.entityId] });
  }
}
