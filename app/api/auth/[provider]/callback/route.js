import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { baseUrl } from "@/lib/mail";
import { createSession, getSession } from "@/lib/session";
import { PROVIDERS, providerConfigured, trustedEmailFromClaims } from "@/lib/auth/providers";
import { clearAuthState, completeAuth } from "@/lib/auth/oauth";
import { findIdentity, linkIdentity, touchIdentity } from "@/lib/auth/identities";

/* Step 2 of social sign-in: what the provider redirects (or POSTs) back to.

   SIGN-IN NEVER CREATES AN ACCOUNT. A portal account carries a role, a branch
   and a pay tier — things an admin decides, and things that determine what
   somebody is paid. Letting a Google sign-in mint one would mean anybody with a
   Google account could get a foothold in a payroll system. So this either finds
   an existing profile or refuses, and the refusal tells them to ask their admin.

   A profile is found in one of two ways:
     • by the provider's subject, if this account was linked before — the only
       way that can't be spoofed, and how a personal Gmail or an Apple relay
       address signs in; or
     • by a VERIFIED email that matches a profile, on first use. See
       trustedEmailFromClaims in lib/auth/providers.js for what "verified"
       means per provider — an asserted email is not enough. */

export const dynamic = "force-dynamic";

async function handle(providerId, { code, state, error }) {
  const home = baseUrl();
  const fail = (reason) => NextResponse.redirect(`${home}/login?error=${reason}`);

  if (!PROVIDERS[providerId] || !providerConfigured(providerId)) return fail("unavailable");
  // The person tapped "Cancel" on the consent screen, or the provider refused.
  if (error) return fail("cancelled");

  let result;
  try {
    result = await completeAuth(providerId, { code, state });
  } catch {
    return fail("failed");
  } finally {
    // One-shot: the state cookie is spent whether or not the exchange worked.
    await clearAuthState();
  }

  const { mode, profileId: linkTarget, claims } = result;
  const db = getDb();
  const now = new Date().toISOString();
  const subject = String(claims.sub);
  const claimEmail = String(claims.email || claims.preferred_username || "").trim().toLowerCase();

  if (mode === "link") {
    // Re-check the live session against the profile pinned when the flow
    // started. If they signed out (or into a different account) mid-flow, the
    // identity must not land on whoever is signed in now.
    const session = await getSession();
    if (!session?.userId || session.userId !== linkTarget) return fail("link_session");

    const linked = linkIdentity(db, {
      profileId: session.userId,
      provider: providerId,
      subject,
      // Shown on the profile page so a teacher can see WHICH account is
      // connected. Stored even when it isn't trusted for matching — it is a
      // label here, never a credential.
      email: claimEmail || null,
      whenIso: now,
    });
    if (!linked.ok) return NextResponse.redirect(`${home}/profile?link_error=claimed&provider=${providerId}`);
    return NextResponse.redirect(`${home}/profile?linked=${providerId}`);
  }

  let profile = null;

  const identity = findIdentity(db, providerId, subject);
  if (identity) {
    profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(identity.profile_id) || null;
    if (profile) touchIdentity(db, providerId, subject, now);
  }

  if (!profile) {
    const trustedEmail = trustedEmailFromClaims(providerId, claims);
    if (trustedEmail) {
      profile = db.prepare("SELECT * FROM profiles WHERE email = ?").get(trustedEmail) || null;
      // First social sign-in for an existing teacher: remember the link, so
      // later sign-ins match on the subject and survive an email change.
      if (profile) {
        linkIdentity(db, {
          profileId: profile.id,
          provider: providerId,
          subject,
          email: trustedEmail,
          whenIso: now,
        });
      }
    }
  }

  if (!profile) return NextResponse.redirect(`${home}/login?error=no_account&provider=${providerId}`);

  // The forced first-password change still applies. Signing in with Google is
  // an extra door into the same account, not a way around the account's state.
  const mustChange = !!profile.must_change_password;
  await createSession({
    userId: profile.id,
    role: profile.role,
    fullName: profile.full_name,
    primaryLocation: profile.primary_location,
    mustChange,
  });

  return NextResponse.redirect(`${home}${mustChange ? "/change-password" : "/dashboard"}`);
}

export async function GET(request, ctx) {
  const { provider } = await ctx.params;
  const params = new URL(request.url).searchParams;
  return handle(provider, {
    code: params.get("code"),
    state: params.get("state"),
    error: params.get("error"),
  });
}

/* Apple only. Asking Apple for any scope switches it to response_mode=form_post,
   so the result arrives as a cross-site POST rather than a redirect — which is
   also why the state cookie is SameSite=None (see lib/auth/oauth.js). */
export async function POST(request, ctx) {
  const { provider } = await ctx.params;
  const form = await request.formData().catch(() => null);
  return handle(provider, {
    code: form?.get("code") || null,
    state: form?.get("state") || null,
    error: form?.get("error") || null,
  });
}
