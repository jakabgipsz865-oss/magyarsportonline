import { describe, expect, it } from "vitest";
import { computeFingerprint } from "./fingerprint";

describe("computeFingerprint", () => {
  it("is deterministic for identical input", () => {
    const input = {
      category: "labdarugas-bl",
      primaryEntityId: "11111111-1111-4111-8111-111111111111",
      dateBucket: "2026-07-27",
    };
    expect(computeFingerprint(input)).toBe(computeFingerprint(input));
  });

  it("is case- and whitespace-insensitive on category", () => {
    const a = computeFingerprint({
      category: "Labdarugas-BL ",
      primaryEntityId: "11111111-1111-4111-8111-111111111111",
      dateBucket: "2026-07-27",
    });
    const b = computeFingerprint({
      category: "labdarugas-bl",
      primaryEntityId: "11111111-1111-4111-8111-111111111111",
      dateBucket: "2026-07-27",
    });
    expect(a).toBe(b);
  });

  it("differs when the primary entity differs", () => {
    const a = computeFingerprint({
      category: "labdarugas-bl",
      primaryEntityId: "11111111-1111-4111-8111-111111111111",
      dateBucket: "2026-07-27",
    });
    const b = computeFingerprint({
      category: "labdarugas-bl",
      primaryEntityId: "22222222-2222-4222-8222-222222222222",
      dateBucket: "2026-07-27",
    });
    expect(a).not.toBe(b);
  });

  it("differs when the date bucket differs", () => {
    const a = computeFingerprint({
      category: "labdarugas-bl",
      primaryEntityId: "11111111-1111-4111-8111-111111111111",
      dateBucket: "2026-07-27",
    });
    const b = computeFingerprint({
      category: "labdarugas-bl",
      primaryEntityId: "11111111-1111-4111-8111-111111111111",
      dateBucket: "2026-07-28",
    });
    expect(a).not.toBe(b);
  });

  it("produces a 64-character hex digest (sha256)", () => {
    const hash = computeFingerprint({
      category: "labdarugas-bl",
      primaryEntityId: "11111111-1111-4111-8111-111111111111",
      dateBucket: "2026-07-27",
    });
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });
});
