import { eq } from "drizzle-orm";
import type { Database } from "../client";
import { categories } from "../schema/index";

export type Category = typeof categories.$inferSelect;

export class CategoryRepository {
  constructor(private readonly db: Database) {}

  async getBySlug(slug: string): Promise<Category | null> {
    const [row] = await this.db.select().from(categories).where(eq(categories.slug, slug)).limit(1);
    return row ?? null;
  }
}
