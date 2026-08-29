import { NextResponse, type NextRequest } from "next/server";
import {
  ADMIN_SESSION_COOKIE,
  ADMIN_SESSION_TTL_SECONDS,
  createAdminSessionToken,
  safeAdminRedirect,
  verifyAdminPassword,
} from "../../../../lib/admin-auth";

export const runtime = "nodejs";

export async function POST(request: NextRequest): Promise<NextResponse> {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  const formData = await request.formData();
  const password = formData.get("password");
  const next = safeAdminRedirect(formData.get("next"));
  const adminSecret = process.env["ADMIN_SECRET"];
  const loginUrl = new URL("/admin/login", request.url);
  loginUrl.searchParams.set("next", next);

  if (!adminSecret || adminSecret.length < 8) {
    loginUrl.searchParams.set("error", "disabled");
    return NextResponse.redirect(loginUrl, 303);
  }
  if (typeof password !== "string" || !(await verifyAdminPassword(password, adminSecret))) {
    loginUrl.searchParams.set("error", "invalid");
    return NextResponse.redirect(loginUrl, 303);
  }

  const response = NextResponse.redirect(new URL(next, request.url), 303);
  response.cookies.set(ADMIN_SESSION_COOKIE, await createAdminSessionToken(adminSecret), {
    httpOnly: true,
    secure: process.env["NODE_ENV"] === "production",
    sameSite: "strict",
    path: "/",
    maxAge: ADMIN_SESSION_TTL_SECONDS,
  });
  response.headers.set("Cache-Control", "no-store");
  return response;
}
