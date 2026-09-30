import { describe, expect, it, vi } from "vitest";
import { sqliteD1 } from "./testing/sqlite-d1";
import { loadWriterHealth, recordWriterFailure } from "./writer-health";

describe("Writer billing health from safe runtime evidence", () => {
  it("distinguishes missing evidence, billing block, successful recovery and app budget", async () => {
    const { db, d1 } = sqliteD1(["0001_initial", "0004_language_qa"]);
    const activation = new Date("2026-09-28T00:00:00Z");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-30T10:00:00Z"));
    try {
      expect(await loadWriterHealth(d1, activation)).toMatchObject({
        status: "WARNING",
        reason: "no_recent_writer_evidence",
      });
      await recordWriterFailure(
        d1,
        "billing_unavailable",
        new Date("2026-09-30T10:30:00Z"),
        "BLOCKED",
      );
      expect(await loadWriterHealth(d1, activation)).toMatchObject({
        status: "BLOCKED",
        reason: "billing_unavailable",
        retryAt: "2026-09-30T10:30:00.000Z",
      });
      db.prepare(
        "INSERT INTO llm_usage(id,provider,model,input_tokens,output_tokens,cost_usd,role,status,occurred_at) VALUES('ok','gemini','gemini-3.5-flash-lite',1,1,'0.001','primary','success','2026-09-30T10:31:00Z')",
      ).run();
      vi.setSystemTime(new Date("2026-09-30T10:32:00Z"));
      expect(await loadWriterHealth(d1, activation)).toMatchObject({
        status: "OK",
        reason: "recent_success",
      });
      await recordWriterFailure(d1, "monthly_budget", new Date("2026-10-01T00:05:00Z"), "BLOCKED");
      expect(await loadWriterHealth(d1, activation)).toMatchObject({
        status: "BLOCKED",
        reason: "monthly_budget",
      });
      await recordWriterFailure(
        d1,
        "SECRET raw provider body",
        new Date("2026-10-01T00:05:00Z"),
        "BLOCKED",
      );
      expect(JSON.stringify(await loadWriterHealth(d1, activation))).not.toContain("SECRET");
      expect(
        JSON.stringify(db.prepare("SELECT detail FROM operational_state").all()),
      ).not.toContain("SECRET");
    } finally {
      db.close();
      vi.useRealTimers();
    }
  });
  it("sees an existing active quota deferral even before health telemetry exists", async () => {
    const { db, d1 } = sqliteD1(["0001_initial", "0004_language_qa"]);
    try {
      db.exec(`INSERT INTO pipeline_jobs(id,event,status,attempts,max_attempts,available_at,claim_version,last_error,created_at,updated_at)
        VALUES('held','{}','pending',0,5,'2026-10-01T00:05:00Z',0,'[monthly_ai_budget:gemini] secret body','2026-09-30T10:00:00Z','2026-09-30T10:00:00Z')`);
      const health = await loadWriterHealth(
        d1,
        new Date("2026-09-28T00:00:00Z"),
        new Date("2026-09-30T10:01:00Z"),
      );
      expect(health).toMatchObject({
        status: "BLOCKED",
        reason: "monthly_budget",
        retryAt: "2026-10-01T00:05:00Z",
      });
      expect(JSON.stringify(health)).not.toContain("secret body");
    } finally {
      db.close();
    }
  });
});
