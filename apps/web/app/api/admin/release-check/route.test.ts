import { describe, it, expect, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  sql: vi.fn(),
  bound: vi.fn(),
  recover: vi.fn(async (_db: unknown, _ids: string[], _opts: unknown) => [
    { storyId: "fixed", publishable: true },
  ]),
}));
vi.mock("../../../../lib/db", () => ({
  d1Binding: () => ({
    prepare: (sql: string) => {
      mocks.sql(sql);
      return {
        bind: (...ids: string[]) => {
          mocks.bound(ids);
          return { all: async () => ({ results: [] }) };
        },
      };
    },
  }),
}));
vi.mock("../../../../lib/env", () => ({
  env: { D1_PIPELINE_START_AT: new Date("2026-09-28T17:30:00Z"), FORCE_REVIEW_MODE: false },
}));
vi.mock("../../../../lib/draft-recovery", () => ({ recoverSavedDrafts: mocks.recover }));
import { GET } from "./route";
describe("admin release check has no recovery execution or secret export", () => {
  it("reads only the fixed 124 cohort and hard-disables execution regardless of caller input", async () => {
    const response = await GET(),
      body = await response.json();
    expect(body).toMatchObject({
      dryRun: true,
      writerCalls: 0,
      facebookEnqueued: 0,
      publishable: 1,
    });
    expect(mocks.recover.mock.calls[0]?.[1]).toHaveLength(124);
    expect(mocks.recover.mock.calls[0]?.[2]).toMatchObject({
      execute: false,
      executionEnabled: false,
    });
    expect(mocks.bound.mock.calls.map(([ids]) => ids.length)).toEqual([80, 44]);
    expect(mocks.sql.mock.calls.every(([sql]) => /^SELECT/.test(sql))).toBe(true);
    expect(JSON.stringify(body)).not.toContain("CRON_SECRET");
  });
});
