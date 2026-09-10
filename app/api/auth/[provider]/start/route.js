import { cookies } from "next/headers";
import { encrypt, getSession } from "@/lib/session";
import { isProvider, providerConfigured, beginAuth, appOrigin } from "@/lib/auth/oauth";

// Only route methods may be exported from a route file, so the cookie name is
// repeated in the callback route.
const OAUTH_COOKIE = "lqk_oauth";

// GET /api/auth/<provider>/start[?mode=link]
//
// Sends the person to the provider. What we need back at the callback
// (state, nonce, PKCE verifier, and whether this is a sign-in or a "link to
// my account" from the profile page) rides in a signed, httpOnly cookie that
// lives ten minutes. `/api` is outside the page proxy, so a signed-out
// person can reach this — that is the point.
export async function GET(request, ctx) {
  const { provider } = await ctx.params;
  if (!isProvider(provider) || !providerConfigured(provider)) {
    return Response.redirect(new URL("/login?error=provider", request.url), 302);
  }
  const mode = request.nextUrl.searchParams.get("mode") === "link" ? "link" : "signin";
  const session = await getSession();
  // Linking needs a signed-in person to link TO.
  if (mode === "link" && !session?.userId) return Response.redirect(new URL("/login", request.url), 302);

  const origin = appOrigin(request.headers);
  const { url, state, nonce, verifier } = beginAuth(provider, { origin });
  const token = await encrypt({ p: provider, s: state, n: nonce, v: verifier, m: mode, u: mode === "link" ? session.userId : null });
  const store = await cookies();
  store.set(OAUTH_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth",
    maxAge: 600,
  });
  return Response.redirect(url, 302);
}
