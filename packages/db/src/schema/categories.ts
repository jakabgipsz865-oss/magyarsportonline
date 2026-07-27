import { pgTable, text, uuid } from "drizzle-orm/pg-core";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

export const categories = pgTable("categories", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameHu: text("name_hu").notNull(),
  parentId: uuid("parent_id").references((): AnyPgColumn => categories.id),
});
