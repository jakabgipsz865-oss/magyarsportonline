import { pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { socialPlatformEnum, socialPostStatusEnum } from "./enums";
import { storyVersions } from "./story-versions";
import { stories } from "./stories";

/**
 * A `status='posting'` állapot és a `(storyVersionId, platform)` unique
 * constraint együtt adják a külső, nem-idempotens API-hívás elleni védelmet
 * (docs/architecture/09-architecture-review.md §9, 02-agents.md §2.8): a
 * sor a tényleges Facebook/X hívás ELŐTT jön létre, így egy retry a hívás
 * előtt látja, hogy már történt (részleges) posztolási kísérlet.
 */
export const socialPosts = pgTable(
  "social_posts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    storyId: uuid("story_id")
      .notNull()
      .references(() => stories.id),
    storyVersionId: uuid("story_version_id")
      .notNull()
      .references(() => storyVersions.id),
    platform: socialPlatformEnum("platform").notNull(),
    externalPostId: text("external_post_id"),
    postText: text("post_text").notNull(),
    status: socialPostStatusEnum("status").notNull().default("queued"),
    postedAt: timestamp("posted_at", { withTimezone: true }),
  },
  (table) => [
    unique("social_posts_story_version_id_platform_unique").on(
      table.storyVersionId,
      table.platform,
    ),
  ],
);
