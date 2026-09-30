import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  vi.resetModules();
});
async function configuredEnv(cap: string | undefined) {
  vi.resetModules();
  vi.stubEnv("CRON_SECRET", "local-env-validation-fixture");
  vi.stubEnv("GEMINI_MONTHLY_BUDGET_USD", cap);
  return (await import("./env")).env;
}
describe("monthly Writer budget configuration", () => {
  it("accepts the production $30 cap and keeps the model/daily cap/QA/recovery defaults", async () => {
    const env = await configuredEnv("30");
    expect(env.GEMINI_MONTHLY_BUDGET_USD).toBe(30);
    expect(env.GEMINI_MODEL).toBe("gemini-3.5-flash-lite");
    expect(env.GEMINI_DAILY_REQUEST_CAP).toBe(450);
    expect(env.LANGUAGE_QA_ENABLED).toBe(false);
    expect(env.LANGUAGE_QA_DAILY_BUDGET_USD).toBe(0.5);
    expect(env.DRAFT_RECOVERY_ENABLED).toBe(false);
  });
  it("defaults to $30 and accepts the finite $50 safety maximum", async () => {
    expect((await configuredEnv(undefined)).GEMINI_MONTHLY_BUDGET_USD).toBe(30);
    expect((await configuredEnv("50")).GEMINI_MONTHLY_BUDGET_USD).toBe(50);
  });
  it.each(["50.01", "0", "-1", "Infinity", "NaN"])("rejects unsafe budget %s", async (cap) => {
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    await expect(configuredEnv(cap)).rejects.toThrow();
  });
});
