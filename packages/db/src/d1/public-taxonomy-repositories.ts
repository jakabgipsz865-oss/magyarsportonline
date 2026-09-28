import type { Category } from "../repositories/category-repository";
import type { Entity } from "../repositories/entity-repository";
import type { D1Client } from "./client";

interface CategoryRow {
  id: string;
  slug: string;
  name_hu: string;
  parent_id: string | null;
}
interface EntityRow {
  id: string;
  type: Entity["type"];
  name_canonical: string;
  name_hu: string;
  aliases: string;
  external_ref: string | null;
}

const category = (row: CategoryRow): Category => ({
  id: row.id,
  slug: row.slug,
  nameHu: row.name_hu,
  parentId: row.parent_id,
});
const entity = (row: EntityRow): Entity => ({
  id: row.id,
  type: row.type,
  nameCanonical: row.name_canonical,
  nameHu: row.name_hu,
  aliases: JSON.parse(row.aliases),
  externalRef: row.external_ref,
});

/** D1 versions of the two small public taxonomy reads. */
export class D1PublicCategoryRepository {
  constructor(private readonly db: D1Client) {}
  async getBySlug(slug: string): Promise<Category | null> {
    const row = await this.db
      .prepare("SELECT * FROM categories WHERE slug = ? LIMIT 1")
      .bind(slug)
      .first<CategoryRow>();
    return row ? category(row) : null;
  }
  async listAll(): Promise<Category[]> {
    const result = await this.db
      .prepare("SELECT * FROM categories ORDER BY name_hu")
      .all<CategoryRow>();
    return result.results.map(category);
  }
}

export class D1PublicEntityRepository {
  constructor(private readonly db: D1Client) {}
  async listAll(): Promise<Entity[]> {
    const result = await this.db
      .prepare("SELECT * FROM entities ORDER BY name_hu")
      .all<EntityRow>();
    return result.results.map(entity);
  }
}
