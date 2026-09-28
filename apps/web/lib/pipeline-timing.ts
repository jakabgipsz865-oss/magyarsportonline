import { getLogger } from "./logger";

/** Logs only stable IDs and timings; never article content or credentials. */
export async function timedPipelineStage<T>(
  stage: string,
  context: {
    jobId?: string | undefined;
    rawArticleId?: string | undefined;
    storyId?: string | undefined;
    sourceId?: string | undefined;
    attempt?: number | undefined;
    leaseOwner?: string | undefined;
  },
  run: () => Promise<T>,
): Promise<T> {
  const startedAt = Date.now();
  const fields = {
    stage,
    ...(context.jobId ? { jobId: context.jobId } : {}),
    ...(context.rawArticleId ? { rawArticleId: context.rawArticleId } : {}),
    ...(context.storyId ? { storyId: context.storyId } : {}),
    ...(context.sourceId ? { sourceId: context.sourceId } : {}),
    ...(context.attempt === undefined ? {} : { attempt: context.attempt }),
    ...(context.leaseOwner ? { leaseOwner: context.leaseOwner } : {}),
  };
  getLogger().info(fields, "pipeline stage started");
  try {
    const result = await run();
    getLogger().info({ ...fields, durationMs: Date.now() - startedAt }, "pipeline stage completed");
    return result;
  } catch (error) {
    getLogger().error(
      {
        ...fields,
        durationMs: Date.now() - startedAt,
        errorName: error instanceof Error ? error.name : "unknown",
      },
      "pipeline stage failed",
    );
    throw error;
  }
}
