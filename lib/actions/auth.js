"use server";

import { randomUUID, timingSafeEqual } from "node:crypto";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { LOCATIONS } from "@/lib/locations";
import { attachToRoster } from "@/lib/roster";
import { hashPassword, verifyPassword } from "@/lib/hash";
import { createSession, deleteSession } from "@/lib/session";
import { baseUrl, mailConfigured, sendMail } from "@/lib/mail";
import { PROVIDERS } from "@/lib/auth/providers";
import { unlinkIdentity } from "@/lib/auth/identities";
import {
  RESET_MAX_PER_HOUR,
  createResetToken,
  findResetByToken,
  isResetUsable,
  markResetUsed,
  recentResetCount,
} from "@/lib/auth/reset";
import { resetEmailHtml, resetEmailSubject, resetEmailText } from "@/lib/auth/mail";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * HQ is the one branch that grants the admin role at sign-up, so it is gated by
 * a shared code an admin hands out (LQK_HQ_CODE).
 *
 * Fails closed on purpose: with no code configured, HQ sign-up is refused
 * outright. An unset environment variable must never read as "admin for
 * anyone" — that is exactly the mistake that would open the whole portal.
 */
function hqCodeMatches(supplied) {
  // Trimmed both sides: a stray space pasted into the host's env var field
  // would otherwise make a correct code silently never match.
  const expected = String(process.env.LQK_HQ_CODE || "").trim();
  if (!expected) return false;
  const given = Buffer.from(String(supplied || ""));
  const wanted = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch, so check that first.
  return given.length === wanted.length && timingSafeEqual(given, wanted);
}

export async function login(prevState, formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");

  if (!email || !password) {
    return { error: "Enter your email and password." };
  }

  const db = getDb();
  const profile = db.prepare("SELECT * FROM profiles WHERE email = ?").get(email);

  if (!profile || !verifyPassword(password, profile.password_hash)) {
    return { error: "Invalid email or password." };
  }

  const mustChange = !!profile.must_change_password;
  await createSession({
    userId: profile.id,
    role: profile.role,
    fullName: profile.full_name,
    primaryLocation: profile.primary_location,
    mustChange,
  });

  redirect(mustChange ? "/change-password" : "/dashboard");
}

/**
 * Self-registration. Open — anyone with the URL can create an account.
 *
 * An invite is no longer required, only an optional shortcut: if an admin
 * pre-added this address in Admin → Invited emails, the new account inherits
 * the role, branch(es), position and pay tier from it. Without one the account
 * starts as a plain teacher at the branch they picked, with no pay tier, and an
 * admin assigns the rest in Admin → Users.
 *
 * The role is never read from the form — only from an invite an admin created.
 * Otherwise anyone registering could hand themselves the admin role.
 */
export async function register(prevState, formData) {
  const fullName = String(formData.get("full_name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm_password") || "");
  const branch = String(formData.get("primary_location") || "").trim();
  const hqCode = String(formData.get("hq_code") || "").trim();

  if (!fullName) return { error: "Enter your full name." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "The passwords don’t match." };

  const db = getDb();

  if (db.prepare("SELECT 1 FROM profiles WHERE email = ?").get(email)) {
    return { error: "An account with that email already exists — sign in instead." };
  }

  const invite = db.prepare("SELECT * FROM invites WHERE email = ? AND used_at IS NULL").get(email);

  // An invite already carries the branch an admin chose; without one the
  // registrant picks their own, so the account is never branchless (work hours
  // and the roster both key off it).
  const primaryLocation = invite ? invite.primary_location : branch;
  if (!invite && !LOCATIONS.includes(branch)) {
    return { error: "Choose the branch you teach at." };
  }

  // Picking HQ without an invite is what promotes a new account to admin, so it
  // has to clear the shared code. An invite is already an admin's decision and
  // carries its own role, so it skips this entirely.
  const claimingHq = !invite && branch === "HQ";
  if (claimingHq && !process.env.LQK_HQ_CODE) {
    return { error: "HQ sign-up isn’t set up yet. Ask an admin, or pick the branch you teach at." };
  }
  if (claimingHq && !hqCodeMatches(hqCode)) {
    return { error: "That HQ access code isn’t right." };
  }

  const role = invite?.role || (claimingHq ? "admin" : "teacher");
  const now = new Date().toISOString();
  const id = randomUUID();
  db.prepare(
    `INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, position, pay_tier, photo, must_change_password, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL, 0, ?)`
  ).run(
    id,
    fullName,
    email,
    hashPassword(password),
    role,
    primaryLocation || null,
    invite?.position || null,
    invite?.pay_tier || null,
    now
  );

  // Branch access: the chosen branch, plus any extra branches an invite carried.
  let extras = [];
  try {
    const parsed = JSON.parse(invite?.branches || "[]");
    if (Array.isArray(parsed)) extras = parsed;
  } catch {
    // ignore malformed invite branches
  }
  const locations = new Set([...extras, primaryLocation].map((l) => String(l || "").trim()).filter(Boolean));
  const insertLoc = db.prepare(
    "INSERT OR IGNORE INTO teacher_locations (id, teacher_id, location, is_primary) VALUES (?, ?, ?, ?)"
  );
  for (const loc of locations) {
    insertLoc.run(randomUUID(), id, loc, loc === primaryLocation ? 1 : 0);
  }

  if (invite) {
    db.prepare("UPDATE invites SET used_at = ? WHERE id = ?").run(now, invite.id);
  }

  // Put them on the tracked staff roster, claiming their existing row when the
  // name matches one. Wrapped because the account itself is already created: a
  // roster hiccup must not strand someone with a half-finished sign-up they
  // can never retry (their email would now read as taken). An admin can always
  // link it by hand in Achievements → Manage → Account links.
  try {
    attachToRoster(db, {
      profileId: id,
      fullName,
      branch: primaryLocation,
      position: invite?.position || "",
    });
  } catch {
    // leave unlinked; the account is still usable
  }

  await createSession({
    userId: id,
    role,
    fullName,
    primaryLocation,
    mustChange: false,
  });

  redirect("/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}

/**
 * Set a new password. Used for the forced first-login change and from the
 * profile page. Passwords are stored hashed — never written to the Sheet.
 */
export async function changePassword(prevState, formData) {
  const session = await requireSession();
  const current = String(formData.get("current_password") || "");
  const next = String(formData.get("new_password") || "");
  const confirm = String(formData.get("confirm_password") || "");

  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "The new passwords don't match." };

  const db = getDb();
  const profile = db.prepare("SELECT password_hash, must_change_password FROM profiles WHERE id = ?").get(session.userId);
  if (!profile) return { error: "Account not found." };

  // On the forced first-login change we don't require the temp password again;
  // otherwise (profile page) verify the current password.
  if (!profile.must_change_password && !verifyPassword(current, profile.password_hash)) {
    return { error: "Your current password is incorrect." };
  }
  if (verifyPassword(next, profile.password_hash)) {
    return { error: "Please choose a password different from your current one." };
  }

  db.prepare("UPDATE profiles SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    hashPassword(next),
    session.userId
  );

  // Refresh the session so the must-change gate clears.
  await createSession({
    userId: session.userId,
    role: session.role,
    fullName: session.fullName,
    primaryLocation: session.primaryLocation,
    mustChange: false,
  });

  redirect("/dashboard");
}

/* ── Password reset ──────────────────────────────────────────────────────────
   "Forgot password?" on the login page. A one-time link, emailed through
   Resend (lib/mail.js), good for RESET_TTL_MINUTES.

   KNOWN LIMITATION, same as changePassword above: sessions are stateless signed
   JWTs valid for 30 days, so resetting a password does not sign other devices
   out. Fixing that properly means stamping the profile with a password epoch and
   checking it on every request in lib/dal.js — worth doing, but it touches every
   page in the portal and is deliberately not bundled in here. */

// Deliberately identical whether or not the address has an account, whether or
// not the rate limit was hit, and whether or not the send actually succeeded.
// Anything else turns this form into a way to ask the portal "does this person
// work at LQK?" — and 77 real staff addresses is exactly what it must not
// confirm.
const RESET_SENT_NOTICE =
  "If that email address has an account, a reset link is on its way. It expires in an hour — check your spam folder if it doesn't arrive.";

export async function requestPasswordReset(prevState, formData) {
  const email = String(formData.get("email") || "").trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };

  // Not an account fact, so it's safe (and much kinder) to say this out loud
  // rather than pretend a link was sent that never can be.
  if (!mailConfigured()) {
    return { error: "Password reset email isn’t set up on this server yet — ask your admin to reset it for you." };
  }

  const db = getDb();
  const profile = db.prepare("SELECT id, full_name, email FROM profiles WHERE email = ?").get(email);
  if (!profile) return { sent: RESET_SENT_NOTICE };

  if (recentResetCount(db, profile.id) >= RESET_MAX_PER_HOUR) {
    // Silently capped: telling them they've hit a limit would confirm the
    // account exists just as surely as sending the mail would.
    return { sent: RESET_SENT_NOTICE };
  }

  const token = createResetToken(db, profile.id);
  const url = `${baseUrl()}/reset-password?token=${encodeURIComponent(token)}`;
  const firstName = String(profile.full_name || "").split(" ")[0] || "";

  const result = await sendMail({
    to: profile.email,
    subject: resetEmailSubject(),
    html: resetEmailHtml({ name: firstName, url }),
    text: resetEmailText({ name: firstName, url }),
  });
  if (!result.ok) {
    // The token stays valid; they can ask again. Logged rather than shown, for
    // the same non-disclosure reason as everything else in this function.
    console.error("[auth] password reset email failed:", result.error);
  }

  return { sent: RESET_SENT_NOTICE };
}

/**
 * Redeem a reset link. The token is the only credential — whoever holds it
 * proved control of the inbox, which is the whole premise of email reset — so
 * it is checked for expiry AND for having never been used before.
 */
export async function resetPassword(prevState, formData) {
  const token = String(formData.get("token") || "");
  const next = String(formData.get("new_password") || "");
  const confirm = String(formData.get("confirm_password") || "");

  if (next.length < 8) return { error: "New password must be at least 8 characters." };
  if (next !== confirm) return { error: "The new passwords don’t match." };

  const db = getDb();
  const row = findResetByToken(db, token);
  if (!isResetUsable(row)) {
    return { error: "That reset link has expired or has already been used. Ask for a new one." };
  }

  const profile = db.prepare("SELECT * FROM profiles WHERE id = ?").get(row.profile_id);
  if (!profile) return { error: "That reset link is no longer valid. Ask for a new one." };

  // Burnt before the password is written, not after: if anything below throws,
  // the link must not stay live.
  markResetUsed(db, row.id);

  db.prepare("UPDATE profiles SET password_hash = ?, must_change_password = 0 WHERE id = ?").run(
    hashPassword(next),
    profile.id
  );

  // They proved control of the account's inbox, so sign them straight in —
  // asking them to type the password they just chose helps nobody.
  await createSession({
    userId: profile.id,
    role: profile.role,
    fullName: profile.full_name,
    primaryLocation: profile.primary_location,
    mustChange: false,
  });

  redirect("/dashboard");
}

/* ── Connected accounts ──────────────────────────────────────────────────────
   Linking is a redirect flow and lives in app/api/auth/[provider]/. Only the
   disconnect is a plain action.

   Safe to offer unconditionally: every account keeps a usable password (that is
   the deliberate choice behind social sign-in here — it is an extra door, never
   a replacement), so disconnecting a provider can never lock anyone out. */
export async function disconnectProvider(prevState, formData) {
  const session = await requireSession();
  const provider = String(formData.get("provider") || "");
  if (!PROVIDERS[provider]) return { error: "Unknown provider." };

  unlinkIdentity(getDb(), session.userId, provider);
  revalidatePath("/profile");
  return { ok: true, provider };
}
