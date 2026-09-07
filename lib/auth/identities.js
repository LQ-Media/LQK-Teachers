import { randomUUID } from "node:crypto";

/* Reading and writing the oauth_identities table. Every function takes the db
   handle rather than importing it, so these can be exercised against a
   throwaway in-memory database in the tests. */

export function findIdentity(db, provider, subject) {
  return db
    .prepare("SELECT * FROM oauth_identities WHERE provider = ? AND subject = ?")
    .get(provider, String(subject));
}

/* Reshaped into plain objects, NOT returned as query rows: node:sqlite rows have
   a null prototype, and React refuses to serialise one into a Client Component
   ("Only plain objects... can be passed to Client Components"). The profile page
   hands this straight to ConnectedAccounts, so returning rows here throws the
   moment a teacher connects their first account — while an unlinked profile,
   having no rows, looks perfectly fine. See the gotcha in HANDOFF.md §7. */
export function listIdentities(db, profileId) {
  return db
    .prepare("SELECT provider, email, linked_at, last_used_at FROM oauth_identities WHERE profile_id = ? ORDER BY provider")
    .all(profileId)
    .map((row) => ({
      provider: row.provider,
      email: row.email,
      linkedAt: row.linked_at,
      lastUsedAt: row.last_used_at,
    }));
}

export function touchIdentity(db, provider, subject, whenIso) {
  db.prepare("UPDATE oauth_identities SET last_used_at = ? WHERE provider = ? AND subject = ?").run(
    whenIso,
    provider,
    String(subject)
  );
}

/**
 * Attach a provider account to a profile.
 *
 * Returns `{ ok: false, reason: "claimed" }` when that provider account is
 * already attached to somebody else. This is the check that stops two teachers
 * sharing one Google account and thereby being able to sign in as each other —
 * the UNIQUE index backs it up, but a friendly message beats a constraint error.
 *
 * Re-linking the same provider on the same profile is allowed and just refreshes
 * the row: a teacher who switched Google accounts shouldn't have to unlink first.
 */
export function linkIdentity(db, { profileId, provider, subject, email, whenIso }) {
  const existing = findIdentity(db, provider, subject);
  if (existing && existing.profile_id !== profileId) {
    return { ok: false, reason: "claimed" };
  }
  if (existing) {
    db.prepare("UPDATE oauth_identities SET email = ?, last_used_at = ? WHERE id = ?").run(
      email || null,
      whenIso,
      existing.id
    );
    return { ok: true, id: existing.id };
  }

  // One row per provider per profile — connecting a different Google account
  // replaces the old one rather than leaving two live at once, which would make
  // "disconnect Google" ambiguous.
  db.prepare("DELETE FROM oauth_identities WHERE profile_id = ? AND provider = ?").run(profileId, provider);

  const id = randomUUID();
  db.prepare(
    `INSERT INTO oauth_identities (id, profile_id, provider, subject, email, linked_at, last_used_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, profileId, provider, String(subject), email || null, whenIso, whenIso);
  return { ok: true, id };
}

export function unlinkIdentity(db, profileId, provider) {
  db.prepare("DELETE FROM oauth_identities WHERE profile_id = ? AND provider = ?").run(profileId, provider);
}
