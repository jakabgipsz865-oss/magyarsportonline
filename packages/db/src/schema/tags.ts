import { pgTable, text, uuid } from "drizzle-orm/pg-core";

export const tags = pgTable("tags", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  nameHu: text("name_hu").notNull(),
});
