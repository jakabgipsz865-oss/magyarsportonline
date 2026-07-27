import { pgTable, unique, uuid } from "drizzle-orm/pg-core";
import { entities } from "./entities";
import { storyEntityRoleEnum } from "./enums";
import { stories } from "./stories";

export const storyEntities = pgTable(
  "story_entities",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    entityId: uuid("entity_id")
      .notNull()
      .references(() => entities.id),
    role: storyEntityRoleEnum("role").notNull(),
  },
  (table) => [unique("story_entities_story_id_entity_id_unique").on(table.storyId, table.entityId)],
);
