import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../../../../lib/admin-auth";
import { POST } from "./route";

const SECRET = "production-test-secret";
let previousSecret: string | undefined;

function loginRequest(password: string, next = "/admin"): NextRequest {
  return new NextRequest("https://magyarsportonline-web.vercel.app/admin/login/session", {
    method: "POST",
    headers: {
      "content-type": "application/x-www-form-urlencoded",
      origin: "https://magyarsportonline-web.vercel.app",
    },
    body: new URLSearchParams({ password, next }),
  });
}

beforeEach(() => {
  previousSecret = process.env["ADMIN_SECRET"];
  process.env["ADMIN_SECRET"] = SECRET;
});

afterEach(() => {
  if (previousSecret === undefined) delete process.env["ADMIN_SECRET"];
  else process.env["ADMIN_SECRET"] = previousSecret;
});

describe("admin login route", () => {
  it("creates an HttpOnly session for the correct password", async () => {
    const response = await POST(loginRequest(SECRET, "/admin/knowledge"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://magyarsportonline-web.vercel.app/admin/knowledge",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("httponly");
    expect(cookie.toLowerCase()).toContain("samesite=strict");
  });

  it("rejects a wrong password without creating a session", async () => {
    const response = await POST(loginRequest("wrong-password"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toContain("error=invalid");
    expect(response.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a cross-origin login submission", async () => {
    const request = loginRequest(SECRET);
    const headers = new Headers(request.headers);
    headers.set("origin", "https://attacker.example");
    const response = await POST(
      new NextRequest(request.url, {
        method: "POST",
        headers,
        body: new URLSearchParams({ password: SECRET, next: "/admin" }),
      }),
    );
    expect(response.status).toBe(403);
  });
});
