import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { getDb } from "@/lib/db";
import { createSession, encrypt, decrypt } from "@/lib/session";
import { isProvider, providerConfigured, completeAuth, appOrigin } from "@/lib/auth/oauth";

const OAUTH_COOKIE = "lqk_oauth";
const PENDING_COOKIE = "lqk_oauth_pending";

// GET /api/auth/<provider>/callback?code=&state=
//
// The person is back from the provider. In order:
//   1. the state must match the cookie set at /start (and it is one-shot);
//   2. the code becomes an identity: provider + stable subject + email;
//   3. an identity already on file signs that account in;
//   4. otherwise, in "link" mode, it is attached to the signed-in account;
//   5. otherwise an EXACT lower-cased email match to an existing profile
//      links and signs in — never creating an account, never touching a role;
//   6. otherwise the person goes to Register with name and email filled in,
//      and a signed "pending" cookie so the account they create gets the
//      identity attached. They still pick a branch; HQ still needs the code.
export async function GET(request, ctx) {
  const { provider } = await ctx.params;
  const store = await cookies();
  const back = (q) => Response.redirect(new URL(`/login?${q}`, request.url), 302);
  if (!isProvider(provider) || !providerConfigured(provider)) return back("error=provider");

  const sp = request.nextUrl.searchParams;
  const saved = await decrypt(store.get(OAUTH_COOKIE)?.value);
  store.delete(OAUTH_COOKIE);
  if (sp.get("error")) return back(`error=denied&provider=${provider}`);
  const code = sp.get("code");
  const state = sp.get("state");
  if (!code || !state || !saved || saved.p !== provider || saved.s !== state) return back("error=state");

  let who;
  try {
    who = await completeAuth(provider, { code, origin: appOrigin(request.headers), verifier: saved.v, nonce: saved.n });
  } catch (err) {
    console.warn(`[oauth] ${provider} callback failed: ${err?.message}`);
    return back(`error=failed&provider=${provider}`);
  }

  const db = getDb();
  const now = new Date().toISOString();
  const existing = db
    .prepare("SELECT profile_id FROM auth_identities WHERE provider = ? AND provider_subject = ?")
    .get(provider, who.subject);

  // Linking from the profile page.
  if (saved.m === "link" && saved.u) {
    if (existing && existing.profile_id !== saved.u) {
      return Response.redirect(new URL("/profile?linked=taken", request.url), 302);
    }
    if (!existing) {
      db.prepare(
        "INSERT INTO auth_identities (id, profile_id, provider, provider_subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), saved.u, provider, who.subject, who.email, now);
    }
    return Response.redirect(new URL(`/profile?linked=${provider}`, request.url), 302);
  }

  let profile = existing ? db.prepare("SELECT * FROM profiles WHERE id = ?").get(existing.profile_id) : null;

  // First time with this provider: exact email match only, and only when the
  // provider vouches for the address. An unverified email proves nothing.
  if (!profile && who.email && who.emailVerified) {
    const match = db.prepare("SELECT * FROM profiles WHERE email = ?").get(who.email);
    if (match) {
      db.prepare(
        "INSERT INTO auth_identities (id, profile_id, provider, provider_subject, email, created_at) VALUES (?, ?, ?, ?, ?, ?)"
      ).run(randomUUID(), match.id, provider, who.subject, who.email, now);
      profile = match;
    }
  }

  if (profile) {
    const mustChange = !!profile.must_change_password;
    await createSession({
      userId: profile.id,
      role: profile.role,
      fullName: profile.full_name,
      primaryLocation: profile.primary_location,
      mustChange,
    });
    return Response.redirect(new URL(mustChange ? "/change-password" : "/dashboard", request.url), 302);
  }

  // Nobody by that email: register, with the identity waiting in a cookie.
  if (!who.email) return back(`error=noemail&provider=${provider}`);
  const pending = await encrypt({ p: provider, sub: who.subject, e: who.email, n: who.name });
  store.set(PENDING_COOKIE, pending, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 900,
  });
  const q = new URLSearchParams({ register: "1", provider, name: who.name, email: who.email });
  return Response.redirect(new URL(`/login?${q.toString()}`, request.url), 302);
}
