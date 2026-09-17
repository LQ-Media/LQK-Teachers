// Has this person actually signed up, or is their account still sitting there
// unused?
//
// Karim, 17 Sep: "in the login accounts, i want to know who has signed up and
// who hasnt. and those who hasnt, i want to send them reminder email."
//
// Pure — no DB, no server imports — because the same rule has to be read by the
// screen, by the action that sends the reminders, and by a test. Two copies of
// "has this person signed up" is two answers, and the wrong one emails somebody
// who signed up in July.
//
// THERE ARE THREE STATES, NOT TWO, and the third is the one that makes this
// worth a module. An account can be:
//
//   active   — they have signed in and hold a password they chose.
//   never    — an admin created it and nobody has ever signed in. This is the
//              group the reminder exists for.
//   reset    — they HAVE signed in before, but an admin has since reset their
//              password and they have not set a new one. They are locked out
//              of an account they were using, which is a different and more
//              urgent problem than never having started.
//
// Collapsing `reset` into `never` would tell Karim somebody never signed up
// when in fact they did and he broke it; collapsing it into `active` would hide
// a locked-out teacher entirely.

export const STATES = ["active", "never", "reset"];

export const STATE_LABEL = {
  active: "Signed up",
  never: "Never signed in",
  reset: "Password reset — not used yet",
};

/**
 * Which state an account is in.
 *
 * `mustChange` is profiles.must_change_password, `lastLoginAt` is
 * profiles.last_login_at.
 *
 * The two signals answer different questions and both are needed:
 *   lastLoginAt — has anybody ever got in?
 *   mustChange  — is the password currently one WE generated?
 *
 * last_login_at only started being recorded on 17 Sep 2026, so for an account
 * that predates it the honest reading is mustChange alone: a person holding a
 * password they chose has plainly signed in at some point, even though we
 * cannot say when. That is why mustChange = 0 reads as `active` rather than as
 * "never" when there is no login on record — the opposite default would have
 * declared all 71 existing accounts unsigned on the day this shipped.
 */
export function signupState({ mustChange, lastLoginAt }) {
  const everIn = !!lastLoginAt;
  const onTempPassword = !!mustChange;

  if (!onTempPassword) return "active";
  return everIn ? "reset" : "never";
}

/** Is this somebody a reminder should go to? */
export function needsReminder(state) {
  return state === "never" || state === "reset";
}

/**
 * Shape one profile row for the screen.
 *
 * `lastLoginAt` is passed through as the raw ISO string rather than formatted,
 * because formatting a date is the client's job and doing it here would bake a
 * timezone into a pure module.
 */
export function signupRow(row) {
  const state = signupState({ mustChange: row.must_change_password, lastLoginAt: row.last_login_at });
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    role: row.role,
    position: row.position || null,
    primaryLocation: row.primary_location || null,
    state,
    lastLoginAt: row.last_login_at || null,
    createdAt: row.created_at,
    remindedAt: row.reminded_at || null,
    reminderCount: row.reminder_count || 0,
  };
}

/** How many accounts are in each state, for the summary strip. */
export function tally(rows) {
  const out = { total: rows.length, active: 0, never: 0, reset: 0, outstanding: 0 };
  for (const r of rows) {
    out[r.state] = (out[r.state] || 0) + 1;
    if (needsReminder(r.state)) out.outstanding += 1;
  }
  return out;
}

// ---- The send quota ----------------------------------------------------
//
// Resend's free tier is 100 emails a DAY, shared with the Parents portal from
// the same account — see the warning at the top of lib/events/mail.js. With 71
// teachers, one careless "remind everybody" could spend the day's allowance and
// silently fail halfway, leaving nobody able to tell who was actually written
// to. So the cap is enforced rather than documented, and the screen says what
// it is before anybody presses the button.

export const MAX_PER_SEND = 25;

/**
 * Split a requested batch into what will be sent now and what is held back.
 *
 * Returns the whole thing rather than an error: sending 25 of 40 is a useful
 * outcome, and the 15 held back have to be NAMED so the second press knows who
 * it still owes.
 */
export function planSend(ids, { max = MAX_PER_SEND } = {}) {
  const unique = [...new Set((ids || []).map((x) => String(x || "").trim()).filter(Boolean))];
  return {
    send: unique.slice(0, max),
    held: unique.slice(max),
    max,
  };
}
