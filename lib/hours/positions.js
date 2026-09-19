// The POSITION a shift is worked in, and what it means for pay.
//
// Sling puts POSITION on the shift, not on the person, and it has to be there:
// a lead teacher covering an assistant's class is working that class, and a
// teacher doing an afternoon for the events team is not teaching at all. The
// roster has to be able to say which.
//
// This is also what lets ONE form make both kinds of shift, which is what
// Karim asked for — "it will be for teaching and OT shift making, all fields
// the same". Picking the position decides the category and the OT team behind
// it, so there is no second dropdown asking the same question twice.
//
// Pure — no DB, no server imports — because both the form and the action that
// validates it need to agree about this list.

/**
 * `key` is what goes in `shifts.position`. `category` and `otRole` are derived,
 * never stored twice — the position is the single answer.
 *
 * The teaching positions mirror the tiers in rates.js; the OT ones mirror
 * OT_ROLES. Mentoring and IT are tracked-but-unpaid there, and stay so here.
 */
export const SHIFT_POSITIONS = [
  { key: "Lead Teacher", category: "teaching", otRole: null, group: "Teaching" },
  { key: "Lead Teacher (ARS)", category: "teaching", otRole: null, group: "Teaching" },
  { key: "Assistant Teacher", category: "teaching", otRole: null, group: "Teaching" },
  { key: "Probation", category: "teaching", otRole: null, group: "Teaching" },
  { key: "Intern", category: "teaching", otRole: null, group: "Teaching" },
  { key: "Curriculum Team", category: "ot", otRole: "curriculum", group: "Non-teaching" },
  { key: "Events Team", category: "ot", otRole: "events", group: "Non-teaching" },
  { key: "Logistics", category: "ot", otRole: "logistics", group: "Non-teaching" },
  { key: "Mentoring Team", category: "ot", otRole: "mentoring", group: "Non-teaching" },
  { key: "IT Team", category: "ot", otRole: "it", group: "Non-teaching" },
  { key: "Ad-hoc / OT", category: "ot", otRole: null, group: "Non-teaching" },
];

export const POSITION_BY_KEY = Object.fromEntries(SHIFT_POSITIONS.map((p) => [p.key, p]));

/** The groups, in the order the picker should show them. */
export const POSITION_GROUPS = ["Teaching", "Non-teaching"];

/**
 * What a position means. Returns null for anything not on the list.
 *
 * Null rather than a teaching default on purpose: a position nobody recognises
 * must be refused by the caller, not silently turned into a paid teaching
 * shift. Guessing here is guessing about money.
 */
export function positionMeaning(key) {
  return POSITION_BY_KEY[String(key ?? "").trim()] || null;
}

/**
 * The best guess at a position from a teacher's free-text profile title, used
 * to prefill the form rather than to decide anything.
 *
 * The imported Sheet wrote titles by hand ("LEAD TEACHER (ARS)", "Asst
 * Teacher", "INTERN"), so this is deliberately loose. It returns null when it
 * cannot tell, and the form then asks.
 */
export function positionFromProfile(profileTitle) {
  const p = String(profileTitle || "").toUpperCase();
  if (!p) return null;
  if (p.includes("INTERN")) return "Intern";
  if (p.includes("PROBATION")) return "Probation";
  if (p.includes("ARS") && p.includes("LEAD")) return "Lead Teacher (ARS)";
  if (p.includes("LEAD")) return "Lead Teacher";
  if (p.includes("ASSISTANT") || p.includes("ASST")) return "Assistant Teacher";
  if (p.includes("CURRICULUM")) return "Curriculum Team";
  if (p.includes("EVENT")) return "Events Team";
  if (p.includes("LOGISTIC")) return "Logistics";
  if (p.includes("MENTOR")) return "Mentoring Team";
  if (p.includes("IT ")) return "IT Team";
  return null;
}

// ---- Repeat, from Sling's REPEAT menu ----------------------------------

/**
 * Never, this week, or every N weeks up to eight — exactly the menu in the
 * screenshot, because a menu that nearly matches is worse than one that does.
 *
 * `weeks` is the interval passed to expandDates. `bounded` marks the one option
 * that supplies its own end date: "This week" runs to the end of the shift's
 * own week and never asks for an "until".
 */
export const REPEAT_OPTIONS = [
  { key: "never", label: "Never", weeks: 0 },
  { key: "this_week", label: "This week", weeks: 1, bounded: true },
  { key: "weekly", label: "Every week", weeks: 1 },
  ...[2, 3, 4, 5, 6, 7, 8].map((n) => ({
    key: `every_${n}`,
    label: `Every ${n} weeks`,
    weeks: n,
  })),
];

export const REPEAT_BY_KEY = Object.fromEntries(REPEAT_OPTIONS.map((r) => [r.key, r]));

export function repeatMeaning(key) {
  return REPEAT_BY_KEY[String(key ?? "").trim()] || REPEAT_BY_KEY.never;
}

/** Does this repeat need the admin to give an end date? */
export function needsUntil(key) {
  const r = repeatMeaning(key);
  return r.weeks > 0 && !r.bounded;
}
