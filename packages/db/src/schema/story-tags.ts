import { pgTable, primaryKey, uuid } from "drizzle-orm/pg-core";
import { stories } from "./stories";
import { tags } from "./tags";

export const storyTags = pgTable(
  "story_tags",
  {
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id),
  },
  (table) => [primaryKey({ columns: [table.storyId, table.tagId] })],
);
