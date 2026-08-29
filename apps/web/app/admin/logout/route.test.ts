import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../../../lib/admin-auth";
import { GET } from "./route";

describe("admin logout route", () => {
  it("clears the session and returns to login", () => {
    const response = GET(new NextRequest("https://magyarsportonline-web.vercel.app/admin/logout"));
    expect(response.status).toBe(303);
    expect(response.headers.get("location")).toBe(
      "https://magyarsportonline-web.vercel.app/admin/login?loggedOut=1",
    );
    const cookie = response.headers.get("set-cookie") ?? "";
    expect(cookie).toContain(`${ADMIN_SESSION_COOKIE}=`);
    expect(cookie.toLowerCase()).toContain("max-age=0");
  });
});
