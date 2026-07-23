"use server";

import { redirect } from "next/navigation";
import { requireSession } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { hashPassword, verifyPassword } from "@/lib/hash";
import { createSession, deleteSession } from "@/lib/session";

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
