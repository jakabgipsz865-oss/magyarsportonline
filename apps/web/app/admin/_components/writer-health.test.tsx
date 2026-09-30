import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { WriterHealthPanel } from "./writer-health";

describe("safe admin billing alerts", () => {
  it.each(["billing_unavailable", "monthly_budget", "daily_quota"])(
    "displays blocked %s distinctly and never invents a balance",
    (reason) => {
      const html = renderToStaticMarkup(
        <WriterHealthPanel
          health={{
            status: "BLOCKED",
            reason,
            lastSuccessAt: null,
            lastErrorAt: "2026-09-30T10:00:00Z",
            retryAt: "2026-09-30T10:30:00Z",
          }}
        />,
      );
      expect(html).toContain("BLOCKED");
      expect(html).toContain(
        reason === "monthly_budget"
          ? "MSO havi hard cap"
          : reason === "daily_quota"
            ? "napi quota"
            : "AI szolgáltatói/billing hiba",
      );
      expect(html).toContain("Cloudflare credit-egyenleg: nincs programmatikusan bekötve");
    },
  );
});
