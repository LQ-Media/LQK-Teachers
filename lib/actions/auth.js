"use server";

import { redirect } from "next/navigation";
import { getDb } from "@/lib/db";
import { verifyPassword } from "@/lib/hash";
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

  await createSession({
    userId: profile.id,
    role: profile.role,
    fullName: profile.full_name,
    primaryLocation: profile.primary_location,
  });

  redirect("/dashboard");
}

export async function logout() {
  await deleteSession();
  redirect("/login");
}
