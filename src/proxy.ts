import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional basic auth for settings. Enabled only when ADMIN_PASSWORD is set.
 * Protects the settings page and any write to the profile / AI endpoints.
 */
export function proxy(req: NextRequest) {
  const password = process.env.ADMIN_PASSWORD;
  if (!password) return NextResponse.next();
  const isWrite = req.method !== "GET" && req.method !== "HEAD";
  const path = req.nextUrl.pathname;
  const needsAuth = path.startsWith("/settings") || (isWrite && path.startsWith("/api/"));
  if (!needsAuth) return NextResponse.next();
  const header = req.headers.get("authorization") ?? "";
  const [scheme, encoded] = header.split(" ");
  if (scheme === "Basic" && encoded) {
    const [, pass] = atob(encoded).split(":");
    if (pass === password) return NextResponse.next();
  }
  return new NextResponse("Authentication required", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="NUCA Land Assistant"' },
  });
}

export const config = { matcher: ["/settings/:path*", "/api/:path*"] };
