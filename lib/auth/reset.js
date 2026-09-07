import { createHash, randomBytes, randomUUID } from "node:crypto";

/* Password-reset tokens.

   The token is 32 random bytes; only its SHA-256 is written to the database.
   That means a leaked backup contains nothing anyone can reset an account with,
   because the token itself exists in exactly one place — the email that was
   sent. SHA-256 with no salt is right here (unlike for passwords): the input is
   already 256 bits of entropy, so there is nothing for a rainbow table to
   shortcut, and the lookup has to be by exact hash. */

export const RESET_TTL_MINUTES = 60;

// Three links an hour is enough for someone whose first one landed in spam, and
// low enough that the endpoint can't be used to bomb a teacher's inbox — or to
// burn through Resend's 100-a-day free tier in a couple of minutes.
export const RESET_MAX_PER_HOUR = 3;

export function generateResetToken() {
  return randomBytes(32).toString("base64url");
}

export function hashResetToken(token) {
  return createHash("sha256").update(String(token || "")).digest("hex");
}

/** Pure: is this row still redeemable at `now`? */
export function isResetUsable(row, now = new Date()) {
  if (!row) return false;
  if (row.used_at) return false;
  const expires = Date.parse(row.expires_at);
  if (!Number.isFinite(expires)) return false;
  return expires > now.getTime();
}

/** How many reset emails this profile has been sent in the last hour. */
export function recentResetCount(db, profileId, now = new Date()) {
  const since = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
  const row = db
    .prepare("SELECT COUNT(*) AS n FROM password_resets WHERE profile_id = ? AND created_at > ?")
    .get(profileId, since);
  return row?.n ?? 0;
}

/**
 * Issue a token for `profileId` and return the RAW token to put in the email.
 *
 * Any earlier unused token for the profile is burnt first, so the most recent
 * email is always the one that works. A teacher who taps "forgot password"
 * three times then finds three links in their inbox, and reaching for the wrong
 * one — the oldest — is the obvious mistake to design out.
 */
export function createResetToken(db, profileId, now = new Date()) {
  db.prepare("UPDATE password_resets SET used_at = ? WHERE profile_id = ? AND used_at IS NULL").run(
    now.toISOString(),
    profileId
  );

  const token = generateResetToken();
  db.prepare(
    "INSERT INTO password_resets (id, profile_id, token_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?)"
  ).run(
    randomUUID(),
    profileId,
    hashResetToken(token),
    now.toISOString(),
    new Date(now.getTime() + RESET_TTL_MINUTES * 60 * 1000).toISOString()
  );
  return token;
}

/** The row a raw token points at, or null. Does NOT check expiry — see isResetUsable. */
export function findResetByToken(db, token) {
  if (!token) return null;
  return db.prepare("SELECT * FROM password_resets WHERE token_hash = ?").get(hashResetToken(token)) || null;
}

export function markResetUsed(db, id, now = new Date()) {
  db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").run(now.toISOString(), id);
}
