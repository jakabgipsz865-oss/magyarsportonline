import { NextResponse, type NextRequest } from "next/server";
import { ADMIN_SESSION_COOKIE } from "../../../lib/admin-auth";

/**
 * Az alkalmazásszintű admin session törlése, majd visszairányítás a loginra.
 */
export function GET(request: NextRequest): NextResponse {
  const response = NextResponse.redirect(new URL("/admin/login?loggedOut=1", request.url), 303);
  response.cookies.set(ADMIN_SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 0,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
