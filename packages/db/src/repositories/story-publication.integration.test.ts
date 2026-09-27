import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { PipelineJobRepository, LostJobClaimError } from "./pipeline-job-repository";
import { StoryRepository } from "./story-repository";

const url = process.env["MSO_TEST_DATABASE_URL"];

describe.skipIf(!url)("fenced Story publication", () => {
  let client: ReturnType<typeof postgres>;
  let jobs: PipelineJobRepository;
  let stories: StoryRepository;

  beforeAll(async () => {
    client = postgres(url!, { max: 4 });
    await client.unsafe(`CREATE TABLE IF NOT EXISTS pipeline_jobs (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), event jsonb NOT NULL,
      status text NOT NULL DEFAULT 'pending', attempts integer NOT NULL DEFAULT 0,
      max_attempts integer NOT NULL DEFAULT 5, available_at timestamptz NOT NULL DEFAULT now(),
      locked_at timestamptz, claim_owner text, claim_version integer NOT NULL DEFAULT 0,
      last_error text, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.unsafe(`CREATE TABLE IF NOT EXISTS stories (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), status text NOT NULL DEFAULT 'draft',
      current_version_id uuid, published_at timestamptz, last_updated_at timestamptz NOT NULL DEFAULT now()
    )`);
    await client.unsafe(`CREATE TABLE IF NOT EXISTS story_versions (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), story_id uuid NOT NULL REFERENCES stories(id),
      is_published boolean NOT NULL DEFAULT false
    )`);
    await client.unsafe(`CREATE TABLE IF NOT EXISTS social_posts (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      story_id uuid NOT NULL REFERENCES stories(id),
      story_version_id uuid NOT NULL REFERENCES story_versions(id),
      platform text NOT NULL, status text NOT NULL, post_text text NOT NULL,
      canonical_url text, external_post_id text, error_code text, last_error text,
      attempt_count integer NOT NULL DEFAULT 0, enqueued_at timestamptz,
      last_attempt_at timestamptz, posted_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (story_id, platform), UNIQUE (story_version_id, platform)
    )`);
    await client.unsafe(`ALTER TABLE social_posts
      ADD COLUMN IF NOT EXISTS external_post_id text,
      ADD COLUMN IF NOT EXISTS error_code text,
      ADD COLUMN IF NOT EXISTS last_error text,
      ADD COLUMN IF NOT EXISTS attempt_count integer NOT NULL DEFAULT 0,
      ADD COLUMN IF NOT EXISTS enqueued_at timestamptz,
      ADD COLUMN IF NOT EXISTS last_attempt_at timestamptz,
      ADD COLUMN IF NOT EXISTS posted_at timestamptz,
      ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now()`);
    const db = drizzle(client);
    jobs = new PipelineJobRepository(db as never);
    stories = new StoryRepository(db as never);
  });
  beforeEach(async () => {
    await client.unsafe("TRUNCATE social_posts, story_versions, stories, pipeline_jobs");
  });
  afterAll(async () => { await client?.end(); });

  it("rejects a late owner and publishes one version exactly once", async () => {
    const [job] = await client.unsafe<{ id: string }[]>(`INSERT INTO pipeline_jobs (event,status,locked_at,claim_owner,claim_version)
      VALUES ('{}','in_progress',now() - interval '20 minutes','old-owner',1) RETURNING id`);
    const [story] = await client.unsafe<{ id: string }[]>("INSERT INTO stories DEFAULT VALUES RETURNING id");
    const [version] = await client.unsafe<{ id: string }[]>("INSERT INTO story_versions (story_id) VALUES ($1) RETURNING id", [story!.id]);
    const [reclaimed] = await jobs.claimBatch(1, 1000, new Date(0));
    expect(reclaimed?.id).toBe(job!.id);
    expect(reclaimed?.claimOwner).not.toBe("old-owner");
    const intent = { postText: "Magyar hír", canonicalUrl: "https://mso24.hu/hir/proba" };
    await expect(stories.publishVersionIfClaim(story!.id, version!.id, new Date(), {
      jobId: job!.id, owner: "old-owner",
    }, intent)).rejects.toBeInstanceOf(LostJobClaimError);
    const claim = { jobId: job!.id, owner: reclaimed!.claimOwner! };
    expect((await client.unsafe("SELECT count(*)::int AS count FROM social_posts"))[0]?.["count"]).toBe(0);
    expect(await stories.publishVersionIfClaim(story!.id, version!.id, new Date(), claim, intent)).toBe(true);
    expect(await stories.publishVersionIfClaim(story!.id, version!.id, new Date(), claim, intent)).toBe(true);
    expect(await jobs.complete(job!.id, "old-owner")).toBe(false);
    expect(await jobs.complete(job!.id, claim.owner)).toBe(true);
    const [savedStory] = await client.unsafe<{ status: string; current_version_id: string }[]>(
      "SELECT status,current_version_id FROM stories WHERE id=$1", [story!.id]);
    const [savedVersion] = await client.unsafe<{ is_published: boolean }[]>(
      "SELECT is_published FROM story_versions WHERE id=$1", [version!.id]);
    expect(savedStory).toMatchObject({ status: "published", current_version_id: version!.id });
    expect(savedVersion?.is_published).toBe(true);
    expect((await client.unsafe("SELECT count(*)::int AS count FROM story_versions"))[0]?.["count"]).toBe(1);
    const [social] = await client.unsafe<{ status: string; canonical_url: string }[]>("SELECT status, canonical_url FROM social_posts WHERE story_id=$1", [story!.id]);
    expect(social).toMatchObject({ status: "queued", canonical_url: intent.canonicalUrl });
    expect((await client.unsafe("SELECT count(*)::int AS count FROM social_posts"))[0]?.["count"]).toBe(1);
  });
});
