import { NextResponse } from "next/server";
import { decrypt } from "@/lib/session";

const PUBLIC_ROUTES = ["/login"];

/* Prefixes anyone may reach WITHOUT a session.

   /i/<token> is a guest's event invitation. Guests are not portal users and
   have no account to log in with, so the auth gate below must not see these —
   without this, every invitation link bounces to /login and the guest concludes
   the invite is broken. The token in the path is the credential, and it is
   verified in lib/events/queries.js#getGuestByToken.

   Keep this as a PREFIX test: the path carries a token, so it can never match
   the exact-equality PUBLIC_ROUTES list.

   /prop/ and /dzikir/ are the invitation's artwork (lantern, stars, the
   confirmation rose) and the email card's crescent. A guest has no session and
   an email client never will, so behind the gate these render as a redirect to
   /login — i.e. broken images on exactly the surfaces outsiders see. Found by
   screenshotting the invite from a cookie-less browser; an authenticated dev
   session masks it completely. */
const PUBLIC_PREFIXES = ["/i/", "/prop/", "/dzikir/"];

export async function proxy(request) {
  const { pathname } = request.nextUrl;
  const isPublicRoute =
    PUBLIC_ROUTES.includes(pathname) || PUBLIC_PREFIXES.some((p) => pathname.startsWith(p));

  const token = request.cookies.get("lqk_session")?.value;
  const session = await decrypt(token);

  if (!isPublicRoute && !session?.userId) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  // Only /login bounces a signed-in user away. An invitation must render the
  // same for everyone — otherwise Karim, who is always signed in, can never
  // preview what he is about to send to 200 guests.
  if (PUBLIC_ROUTES.includes(pathname) && session?.userId) {
    return NextResponse.redirect(new URL("/dashboard", request.url));
  }

  // Force the first-login password change before anything else — but never at
  // the cost of a guest's invitation, which has nothing to do with passwords.
  if (
    session?.userId &&
    session.mustChange &&
    pathname !== "/change-password" &&
    !PUBLIC_PREFIXES.some((p) => pathname.startsWith(p))
  ) {
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
