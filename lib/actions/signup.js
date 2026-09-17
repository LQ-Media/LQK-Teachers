"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { requireFullAdmin } from "@/lib/dal";
import { getDb } from "@/lib/db";
import { hashPassword } from "@/lib/hash";
import { mailConfigured, sendMail } from "@/lib/events/mail";
import { signupRow, tally, needsReminder, planSend, MAX_PER_SEND } from "@/lib/admin/signup";
import { reminderSubject, reminderHtml, reminderText } from "@/lib/admin/signup-email";

// Who has signed up, and chasing the ones who haven't.
//
// Karim, 17 Sep: "in the login accounts, i want to know who has signed up and
// who hasnt. and those who hasnt, i want to send them reminder email for them
// to sign up."
//
// FULL ADMIN ONLY. Sending a reminder RESETS somebody's password, which is a
// thing that can lock a person out of the portal — not a report.

/** Same generator as lib/actions/admin.js, and deliberately the same shape. */
function genTempPassword() {
  const chars = "abcdefghijkmnpqrstuvwxyz23456789"; // no ambiguous 0/o/1/l
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return `lqk-${s}`;
}

/**
 * Every account, with whether it has been signed in to.
 *
 * Also returns the invited-but-never-registered addresses. They are the OTHER
 * half of "who hasn't signed up" — people with no account at all — and leaving
 * them off a screen headed "who has signed up" would answer the question
 * wrongly by omission. They need no reset, only the link, because
 * self-registration is open.
 */
export async function signupStatus() {
  await requireFullAdmin();
  const db = getDb();

  const rows = db
    .prepare(
      `SELECT p.id, p.full_name, p.email, p.role, p.position, p.primary_location,
              p.must_change_password, p.last_login_at, p.created_at,
              (SELECT MAX(r.at) FROM signup_reminders r WHERE r.subject_id = p.id AND r.ok = 1) AS reminded_at,
              (SELECT COUNT(*) FROM signup_reminders r WHERE r.subject_id = p.id AND r.ok = 1) AS reminder_count
       FROM profiles p
       ORDER BY p.full_name ASC`
    )
    .all()
    .map(signupRow);

  const invited = db
    .prepare(
      `SELECT id, email, full_name, role, primary_location, created_at
       FROM invites WHERE used_at IS NULL ORDER BY created_at DESC`
    )
    .all()
    .map((i) => ({
      id: i.id,
      email: i.email,
      name: i.full_name || null,
      role: i.role,
      primaryLocation: i.primary_location || null,
      createdAt: i.created_at,
    }));

  return {
    accounts: rows,
    tally: tally(rows),
    invited,
    // Said out loud, because the screen's button depends on it and "nothing
    // happened" is the worst way to discover an unset environment variable.
    mailReady: mailConfigured(),
    maxPerSend: MAX_PER_SEND,
  };
}

/**
 * Send the sign-up reminder to the accounts named, resetting each password.
 *
 * THE ORDER MATTERS AND IS NOT THE OBVIOUS ONE. The password is written FIRST
 * and the email sent second, per person, one at a time:
 *
 *   • Reset-then-send means a failed email leaves somebody holding a password
 *     they were never told. That is recoverable — the screen shows the failure
 *     and the next press sends a fresh one.
 *   • Send-then-reset means the email goes out with a password that is not yet
 *     the account's, and if the write then fails the person has a credential
 *     that does not work and no way to know why. That is the worse failure, so
 *     it is the one this avoids.
 *
 * Sequential, never Promise.all: Resend rate-limits bursts, and a per-person
 * result is the only way a partial send is visible rather than silent.
 */
export async function sendSignupReminders(ids) {
  const session = await requireFullAdmin();
  const db = getDb();

  if (!mailConfigured()) {
    return {
      error:
        "Email isn’t set up on this server (RESEND_API_KEY is missing), so nothing was sent and no password was changed.",
    };
  }

  const { send, held, max } = planSend(ids);
  if (!send.length) return { error: "Pick at least one person to remind." };

  const results = [];
  for (const id of send) {
    const row = db
      .prepare("SELECT id, full_name, email, must_change_password, last_login_at FROM profiles WHERE id = ?")
      .get(id);

    if (!row) {
      results.push({ id, ok: false, error: "That account no longer exists." });
      continue;
    }

    // Re-checked here, not trusted from the browser. The client sends ids, and
    // a stale screen could name somebody who signed in five minutes ago —
    // resetting THEIR password would lock out a working account.
    const state = signupRow({ ...row, must_change_password: row.must_change_password }).state;
    if (!needsReminder(state)) {
      results.push({ id, name: row.full_name, ok: false, error: "They’ve already signed up — skipped." });
      continue;
    }

    const tempPassword = genTempPassword();
    try {
      db.prepare("UPDATE profiles SET password_hash = ?, must_change_password = 1 WHERE id = ?").run(
        hashPassword(tempPassword),
        row.id
      );
    } catch (err) {
      results.push({ id, name: row.full_name, ok: false, error: `Couldn’t set a new password: ${err?.message || "write failed"}` });
      continue;
    }

    const sent = await sendMail({
      to: row.email,
      subject: reminderSubject(),
      html: reminderHtml({ fullName: row.full_name, email: row.email, tempPassword }),
      text: reminderText({ fullName: row.full_name, email: row.email, tempPassword }),
    });

    // Recorded either way. A failed send is exactly the row somebody needs to
    // see, because that person's password HAS changed and they have not been
    // told — leaving it unlogged is how they become a mystery support ticket.
    try {
      db.prepare(
        `INSERT INTO signup_reminders (id, subject_id, email, sent_by, sent_by_name, ok, error, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        randomUUID(),
        row.id,
        row.email,
        session.userId,
        session.fullName || null,
        sent.ok ? 1 : 0,
        sent.ok ? null : sent.error || "unknown error",
        new Date().toISOString()
      );
    } catch (err) {
      console.error("[signup] could not record the reminder:", err?.message || err);
    }

    results.push({
      id,
      name: row.full_name,
      email: row.email,
      ok: !!sent.ok,
      error: sent.ok ? null : sent.error || "the email provider refused it",
      // Returned so the screen can show it for a FAILED send — that person's
      // password is already changed, and this is the only remaining way to tell
      // them what it is.
      tempPassword: sent.ok ? null : tempPassword,
    });
  }

  revalidatePath("/admin");

  const okCount = results.filter((r) => r.ok).length;
  return {
    ok: true,
    sent: okCount,
    failed: results.length - okCount,
    results,
    held,
    max,
  };
}

/**
 * The reminders sent to one person, newest first.
 *
 * Kept as its own read rather than folded into signupStatus, because it is a
 * per-person detail nobody needs until they ask why somebody was chased three
 * times.
 */
export async function reminderHistory(userId) {
  await requireFullAdmin();
  const rows = getDb()
    .prepare(
      `SELECT id, email, sent_by_name, ok, error, at FROM signup_reminders
       WHERE subject_id = ? ORDER BY at DESC, rowid DESC LIMIT 20`
    )
    .all(String(userId ?? "").trim())
    .map((r) => ({
      id: r.id,
      email: r.email,
      by: r.sent_by_name || "(unknown)",
      ok: !!r.ok,
      error: r.error || null,
      at: r.at,
    }));
  return { entries: rows };
}
