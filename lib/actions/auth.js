"use server";

import { randomUUID } from "node:crypto";
import { redirect } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/hash";
import { createSession, deleteSession } from "@/lib/session";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

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
 * Self-registration, gated by the invited-emails allowlist.
 *
 * An admin pre-adds the teacher's email in Admin → Invited emails, along with
 * the role / branch / pay tier they should receive. Only a matching, unused
 * invite lets an account be created, so the portal (staff data, roster,
 * payroll) is never open to whoever finds the URL. The teacher picks their own
 * password here, which replaces the temp-password handover entirely.
 */
export async function register(prevState, formData) {
  const fullName = String(formData.get("full_name") || "").trim();
  const email = String(formData.get("email") || "").trim().toLowerCase();
  const password = String(formData.get("password") || "");
  const confirm = String(formData.get("confirm_password") || "");

  if (!fullName) return { error: "Enter your full name." };
  if (!EMAIL_RE.test(email)) return { error: "Enter a valid email address." };
  if (password.length < 8) return { error: "Password must be at least 8 characters." };
  if (password !== confirm) return { error: "The passwords don’t match." };

  const db = getDb();

  if (db.prepare("SELECT 1 FROM profiles WHERE email = ?").get(email)) {
    return { error: "An account with that email already exists — sign in instead." };
  }

  const invite = db.prepare("SELECT * FROM invites WHERE email = ? AND used_at IS NULL").get(email);
  if (!invite) {
    return {
      error: "That email isn’t on the invite list yet. Ask your admin to add it, then register again.",
    };
  }

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
    invite.role || "teacher",
    invite.primary_location || null,
    invite.position || null,
    invite.pay_tier || null,
    now
  );

  // Branch access: the invite's primary branch plus any extras it carried.
  let extras = [];
  try {
    const parsed = JSON.parse(invite.branches || "[]");
    if (Array.isArray(parsed)) extras = parsed;
  } catch {
    // ignore malformed invite branches
  }
  const locations = new Set([...extras, invite.primary_location].map((l) => String(l || "").trim()).filter(Boolean));
  const insertLoc = db.prepare(
    "INSERT OR IGNORE INTO teacher_locations (id, teacher_id, location, is_primary) VALUES (?, ?, ?, ?)"
  );
  for (const loc of locations) {
    insertLoc.run(randomUUID(), id, loc, loc === invite.primary_location ? 1 : 0);
  }

  db.prepare("UPDATE invites SET used_at = ? WHERE id = ?").run(now, invite.id);

  await createSession({
    userId: id,
    role: invite.role || "teacher",
    fullName,
    primaryLocation: invite.primary_location,
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
