import { pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { reviewQueueReasonEnum, reviewQueueStatusEnum } from "./enums";
import { storyVersions } from "./story-versions";
import { stories } from "./stories";

export const reviewQueueItems = pgTable("review_queue_items", {
  id: uuid("id").primaryKey().defaultRandom(),
  storyId: uuid("story_id")
    .notNull()
    .references(() => stories.id),
  storyVersionId: uuid("story_version_id")
    .notNull()
    .references(() => storyVersions.id),
  reason: reviewQueueReasonEnum("reason").notNull(),
  status: reviewQueueStatusEnum("status").notNull().default("pending"),
  reviewedBy: uuid("reviewed_by"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at", { withTimezone: true }),
});
