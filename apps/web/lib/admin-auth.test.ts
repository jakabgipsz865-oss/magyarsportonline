import { describe, expect, it } from "vitest";
import {
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  safeAdminRedirect,
  verifyAdminPassword,
  verifyAdminSessionToken,
} from "./admin-auth";

const SECRET = "production-test-secret";
const NOW = Date.UTC(2026, 7, 29, 12, 0, 0);

describe("admin auth", () => {
  it("accepts only the configured password", async () => {
    await expect(verifyAdminPassword(SECRET, SECRET)).resolves.toBe(true);
    await expect(verifyAdminPassword("wrong-password", SECRET)).resolves.toBe(false);
  });

  it("creates a signed session that expires after the configured TTL", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    await expect(verifyAdminSessionToken(token, SECRET, NOW + 1_000)).resolves.toBe(true);
    await expect(
      verifyAdminSessionToken(token, SECRET, NOW + (ADMIN_SESSION_TTL_SECONDS + 1) * 1_000),
    ).resolves.toBe(false);
  });

  it("rejects tampered sessions", async () => {
    const token = await createAdminSessionToken(SECRET, NOW);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;
    await expect(verifyAdminSessionToken(tampered, SECRET, NOW)).resolves.toBe(false);
    await expect(verifyAdminSessionToken(token, "different-secret", NOW)).resolves.toBe(false);
  });

  it("allows only local protected admin redirect targets", () => {
    expect(safeAdminRedirect("/admin/knowledge?tab=export")).toBe("/admin/knowledge?tab=export");
    expect(safeAdminRedirect("/internal/editorial-ab-review")).toBe(
      "/internal/editorial-ab-review",
    );
    expect(safeAdminRedirect("https://attacker.example/")).toBe("/admin");
    expect(safeAdminRedirect("//attacker.example/")).toBe("/admin");
  });
});
