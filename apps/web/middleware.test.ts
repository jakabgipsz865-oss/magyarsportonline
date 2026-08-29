import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE, createAdminSessionToken } from "./lib/admin-auth";
import { middleware } from "./middleware";

const SECRET = "production-test-secret";
let previousSecret: string | undefined;

beforeEach(() => {
  previousSecret = process.env["ADMIN_SECRET"];
  process.env["ADMIN_SECRET"] = SECRET;
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env["ADMIN_SECRET"];
  else process.env["ADMIN_SECRET"] = previousSecret;
});

describe("admin middleware", () => {
  it("redirects an unauthenticated browser route to login", async () => {
    const response = await middleware(
      new NextRequest("https://magyarsportonline-web.vercel.app/admin/knowledge?section=export"),
    );
    expect(response.status).toBe(307);
    expect(response.headers.get("location")).toBe(
      "https://magyarsportonline-web.vercel.app/admin/login?next=%2Fadmin%2Fknowledge%3Fsection%3Dexport",
    );
  });

  it("returns 401 JSON for an unauthenticated admin API", async () => {
    const response = await middleware(
      new NextRequest("https://magyarsportonline-web.vercel.app/api/admin/knowledge/export"),
    );
    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: "unauthorized" });
  });

  it("allows a valid signed session", async () => {
    const token = await createAdminSessionToken(SECRET);
    const response = await middleware(
      new NextRequest("https://magyarsportonline-web.vercel.app/admin", {
        headers: { cookie: `${ADMIN_SESSION_COOKIE}=${token}` },
      }),
    );
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("always allows the login and logout endpoints", async () => {
    for (const path of ["/admin/login", "/admin/login/session", "/admin/logout"]) {
      const response = await middleware(
        new NextRequest(`https://magyarsportonline-web.vercel.app${path}`),
      );
      expect(response.status).toBe(200);
    }
  });
});
