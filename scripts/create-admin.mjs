/**
 * Create (or update) an admin profile — the way to bootstrap the first login
 * in production, where demo accounts are not seeded.
 *
 * Usage:
 *   node scripts/create-admin.mjs --email you@example.com --name "Your Name" --password "…"
 * or via env:
 *   ADMIN_EMAIL=… ADMIN_NAME=… ADMIN_PASSWORD=… node scripts/create-admin.mjs
 *
 * Run it in the same environment as the app (same LQK_DATA_DIR) so it writes
 * to the same database file — e.g. inside the deployed container.
 */

// Guard against demo seeding: getDb() seeds demo accounts unless NODE_ENV is
// production. This bootstrap script must never create demo data, so default to
// production when the caller hasn't set it (the deployed container already has).
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

import { randomUUID } from "node:crypto";
import { getDb } from "../lib/db.js";
import { hashPassword } from "../lib/hash.js";

function arg(flag, envKey) {
  const i = process.argv.indexOf(flag);
  if (i !== -1 && process.argv[i + 1]) return process.argv[i + 1];
  return process.env[envKey];
}

const email = arg("--email", "ADMIN_EMAIL");
const name = arg("--name", "ADMIN_NAME");
const password = arg("--password", "ADMIN_PASSWORD");

if (!email || !name || !password) {
  console.error(
    "Missing required fields.\n" +
      'Usage: node scripts/create-admin.mjs --email you@example.com --name "Your Name" --password "…"'
  );
  process.exit(1);
}
if (password.length < 8) {
  console.error("Password must be at least 8 characters.");
  process.exit(1);
}

const db = getDb();
const now = new Date().toISOString();
const existing = db.prepare("SELECT id FROM profiles WHERE email = ?").get(email);

if (existing) {
  db.prepare("UPDATE profiles SET full_name = ?, password_hash = ?, role = 'admin' WHERE id = ?").run(
    name,
    hashPassword(password),
    existing.id
  );
  console.log(`Updated existing profile ${email} -> admin.`);
} else {
  db.prepare(
    `INSERT INTO profiles (id, full_name, email, password_hash, role, primary_location, created_at)
     VALUES (?, ?, ?, ?, 'admin', NULL, ?)`
  ).run(randomUUID(), name, email, hashPassword(password), now);
  console.log(`Created admin ${email}.`);
}
