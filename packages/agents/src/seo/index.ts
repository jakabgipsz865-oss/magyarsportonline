import { schema, type Database } from "@magyarsportonline/db";
import type { Logger } from "@magyarsportonline/observability";
import { eq } from "drizzle-orm";
import type { RecordAgentRun } from "../telemetry/agent-run-recorder.js";
import { runWithTelemetry } from "../telemetry/run-with-telemetry.js";
import { slugify } from "./slugify.js";

export interface SeoInput {
  storyId: string;
  correlationId: string;
}

export interface SeoResult {
  slug: string;
}

const MAX_SLUG_ATTEMPTS = 20;

/**
 * SEO Agent, MVP scope (docs/architecture/02-agents.md §2.6): slug
 * generation only, first version only. Meta description, tag/category
 * taxonomy, and schema.org structured data are explicitly out of scope for
 * the MVP (YAGNI — the demo doesn't need them to prove the end-to-end
 * loop) and remain future roadmap work.
 */
export async function runSeoAgent(
  deps: { db: Database; logger: Logger; recordAgentRun: RecordAgentRun },
  input: SeoInput,
): Promise<SeoResult> {
  return runWithTelemetry(
    deps,
    {
      agentName: "seo",
      triggerEvent: "story/content.drafted",
      correlationId: input.correlationId,
      storyId: input.storyId,
    },
    async ({ log }) => {
      const story = await deps.db.query.stories.findFirst({
        where: eq(schema.stories.id, input.storyId),
      });
      if (!story) throw new Error(`Story ${input.storyId} not found`);

      if (story.slug) {
        log.info({ slug: story.slug }, "slug already set — SEO Agent only assigns it once");
        return { slug: story.slug };
      }

      const base = slugify(story.canonicalTitle);
      let candidate = base;
      for (let attempt = 1; attempt <= MAX_SLUG_ATTEMPTS; attempt += 1) {
        const existing = await deps.db.query.stories.findFirst({
          where: eq(schema.stories.slug, candidate),
        });
        if (!existing) break;
        candidate = `${base}-${attempt + 1}`;
      }

      await deps.db
        .update(schema.stories)
        .set({ slug: candidate })
        .where(eq(schema.stories.id, input.storyId));

      log.info({ slug: candidate }, "slug assigned");
      return { slug: candidate };
    },
  );
}
