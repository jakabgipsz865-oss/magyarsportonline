import { describe, expect, it } from "vitest";
import { asUuid, isUuid } from "./id";

describe("isUuid", () => {
  it("accepts a valid v4 UUID", () => {
    expect(isUuid("f47ac10b-58cc-4372-a567-0e02b2c3d479")).toBe(true);
  });

  it("rejects a non-UUID string", () => {
    expect(isUuid("ferencvaros-real-madrid-2026")).toBe(false);
  });

  it("rejects an empty string", () => {
    expect(isUuid("")).toBe(false);
  });
});

describe("asUuid", () => {
  it("returns the value when valid", () => {
    const id = "f47ac10b-58cc-4372-a567-0e02b2c3d479";
    expect(asUuid(id)).toBe(id);
  });

  it("throws when invalid", () => {
    expect(() => asUuid("not-a-uuid")).toThrow(/Invalid UUID/);
  });
});
