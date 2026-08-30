export interface PipelineQueuePressure {
  pending: number;
  inProgress: number;
}

/**
 * Keep enough headroom for the downstream fan-out of accepted articles.
 * One new article normally creates roughly six durable stage jobs before it
 * either reaches review/publication or stops at a gate.
 */
export const MAX_ACTIVE_PIPELINE_JOBS = 200;
export const EXPECTED_JOBS_PER_NEW_ARTICLE = 6;
export const MAX_NEW_ARTICLES_PER_INGEST = 3;

export function calculateIngestBudget(queue: PipelineQueuePressure): number {
  const activeJobs = Math.max(0, queue.pending) + Math.max(0, queue.inProgress);
  const remainingJobCapacity = Math.max(0, MAX_ACTIVE_PIPELINE_JOBS - activeJobs);
  return Math.min(
    MAX_NEW_ARTICLES_PER_INGEST,
    Math.floor(remainingJobCapacity / EXPECTED_JOBS_PER_NEW_ARTICLE),
  );
}
