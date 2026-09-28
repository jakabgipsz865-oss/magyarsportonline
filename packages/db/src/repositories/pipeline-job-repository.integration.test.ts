import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { pipelineJobs } from "../schema";
import { PipelineJobRepository } from "./pipeline-job-repository";

const connectionString = process.env["MSO_TEST_DATABASE_URL"];
const integration = describe.skipIf(!connectionString);

integration("PipelineJobRepository PostgreSQL claims", () => {
  let client: ReturnType<typeof postgres>;
  let repo: PipelineJobRepository;
  let db: ReturnType<typeof drizzle>;

  beforeAll(async () => {
    client = postgres(connectionString!, { max: 8 });
    db = drizzle(client);
    await client
      .unsafe(
        "CREATE TYPE pipeline_job_status AS ENUM ('pending','in_progress','completed','dead_letter')",
      )
      .catch((error: unknown) => {
        if (!(error instanceof Error) || !error.message.includes("already exists")) throw error;
      });
    await client.unsafe(`CREATE TABLE IF NOT EXISTS pipeline_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event jsonb NOT NULL,
      status pipeline_job_status NOT NULL DEFAULT 'pending',
      attempts integer NOT NULL DEFAULT 0, max_attempts integer NOT NULL DEFAULT 5,
      available_at timestamptz NOT NULL DEFAULT now(), locked_at timestamptz,
      claim_owner text, claim_version integer NOT NULL DEFAULT 0,
      last_error text, created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    repo = new PipelineJobRepository(db as never);
  });
  beforeEach(async () => {
    await client.unsafe("TRUNCATE pipeline_jobs");
  });
  afterAll(async () => {
    await client?.end();
  });

  const event = (id: string) => ({
    type: "source/article.ingested",
    payload: { raw_article_id: id },
  });

  it("claims distinct rows in parallel and fences an expired owner", async () => {
    await db.insert(pipelineJobs).values([{ event: event("a") }, { event: event("b") }]);
    const [first, second] = await Promise.all([
      repo.claimBatch(1, 1000, new Date(30_000)),
      repo.claimBatch(1, 1000, new Date(30_000)),
    ]);
    expect(first).toHaveLength(1);
    expect(second).toHaveLength(1);
    expect(first[0]!.id).not.toBe(second[0]!.id);
    expect(first[0]!.claimOwner).toBeTruthy();
    expect(first[0]!.claimVersion).toBe(1);

    await client.unsafe(
      "UPDATE pipeline_jobs SET locked_at = now() - interval '20 minutes' WHERE id = $1",
      [first[0]!.id],
    );
    const [reclaimed] = await repo.claimBatch(1, 1000, new Date(0));
    expect(reclaimed?.id).toBe(first[0]!.id);
    expect(reclaimed?.claimOwner).not.toBe(first[0]!.claimOwner);
    expect(reclaimed?.claimVersion).toBe(2);
    expect(await repo.complete(first[0]!.id, first[0]!.claimOwner!)).toBe(false);
    expect(await repo.fail(first[0]!.id, first[0]!.claimOwner!, "late", 1000)).toBe(false);
    expect(await repo.complete(reclaimed!.id, reclaimed!.claimOwner!)).toBe(true);
  });

  it("reserves recovery capacity while fresh work continues", async () => {
    const [stale] = await db
      .insert(pipelineJobs)
      .values({
        event: event("stale"),
        status: "in_progress",
        lockedAt: new Date(Date.now() - 20 * 60_000),
        createdAt: new Date(Date.now() - 30 * 60_000),
        claimOwner: "dead-worker",
        claimVersion: 1,
      })
      .returning();
    await db
      .insert(pipelineJobs)
      .values(Array.from({ length: 8 }, (_, i) => ({ event: event(`fresh-${i}`) })));
    const [fresh] = await repo.claimBatch(1, 1000, new Date(30_000));
    expect(fresh?.status).toBe("in_progress");
    expect(fresh?.id).not.toBe(stale!.id);
    const [recovered] = await repo.claimBatch(1, 1000, new Date(0));
    expect(recovered?.id).toBe(stale!.id);
  });

  it("claims the oldest pending job in a recovery lane despite stale and newly arriving jobs", async () => {
    const [old] = await db
      .insert(pipelineJobs)
      .values({
        event: event("old-pending"),
        createdAt: new Date(Date.now() - 60 * 60_000),
      })
      .returning();
    await db.insert(pipelineJobs).values({
      event: event("stale"),
      status: "in_progress",
      lockedAt: new Date(Date.now() - 20 * 60_000),
      createdAt: new Date(Date.now() - 25 * 60_000),
      claimOwner: "dead-worker",
      claimVersion: 1,
    });
    for (let i = 0; i < 3; i++) {
      await db.insert(pipelineJobs).values({ event: event(`fresh-arrival-${i}`) });
      const [fresh] = await repo.claimBatch(1, 1000, new Date(30_000 + i * 30_000));
      expect(fresh?.id).not.toBe(old!.id);
    }
    const [recovered] = await repo.claimBatch(1, 1000, new Date(0));
    expect(recovered?.id).toBe(old!.id);
  });
});
