import { NextResponse } from "next/server";
import { decrypt } from "@/lib/session";

const PUBLIC_ROUTES = ["/login"];

// Open routes are served to everyone and redirect nobody — unlike /login,
// which bounces an already-signed-in user to the dashboard.
//
// /invite/<slug> is the event invitation a parent opens from their email or
// WhatsApp. Parents have no portal account, so gating it would make every
// invite a dead end; and bouncing signed-in staff to /dashboard would stop an
// admin ever opening their own invite to check it.
const OPEN_PREFIXES = ["/invite/"];

export async function proxy(request) {
  const { pathname } = request.nextUrl;

  if (OPEN_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const isPublicRoute = PUBLIC_ROUTES.includes(pathname);

  const token = request.cookies.get("lqk_session")?.value;
  const session = await decrypt(token);

  if (!isPublicRoute && !session?.userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicRoute && session?.userId) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Force the first-login password change before anything else.
  if (session?.userId && session.mustChange && pathname !== "/change-password") {
    return NextResponse.redirect(new URL("/change-password", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // Skip the auth gate for framework internals AND the public PWA assets
  // (home-screen icon + manifest) so they load without a session — otherwise
  // "Add to Home Screen" can't fetch the icon.
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|apple-icon.png|icon-192.png|icon-512.png|icon-maskable-512.png|manifest.webmanifest|sw.js|offline.html).*)",
  ],
};
