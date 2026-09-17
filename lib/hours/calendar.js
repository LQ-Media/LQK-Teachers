// The month and week grids behind the roster calendar.
//
// Everything here is SINGAPORE DATES as YYYY-MM-DD strings, never Date objects
// carrying a local timezone. That is the whole reason this module exists: a
// calendar built from `new Date()` renders a different month for a server in
// UTC and an admin in Singapore, and the shift that lands in the wrong cell is
// the 11:45pm one — exactly the shift somebody is trying to find.
//
// Pure — no DB, no server imports, no `Date` arithmetic that could drift.

import { addSgDays, sgToday, sgDate } from "./rates.js";

/** Weeks start on Monday, as Sling's schedule does. */
export const WEEK_STARTS_ON = 1; // 0=Sun, 1=Mon
export const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/**
 * Midday is used everywhere a date has to become an instant.
 *
 * Not midnight: a date at 00:00+08:00 is the previous day in UTC, and any
 * later `toISOString().slice(0,10)` would silently step back a day. Midday is
 * twelve hours from either edge, so no offset, rounding or DST quirk can move
 * it across a date boundary.
 */
function noon(date) {
  return new Date(`${date}T12:00:00+08:00`);
}

/** How many days back from `date` to reach the start of its week. */
export function daysIntoWeek(date) {
  const dow = noon(date).getUTCDay(); // 0=Sun
  return (dow - WEEK_STARTS_ON + 7) % 7;
}

/** The Monday of the week containing `date`. */
export function startOfWeek(date) {
  return addSgDays(date, -daysIntoWeek(date));
}

/** The Sunday that ends the week containing `date`. */
export function endOfSgWeek(date) {
  return addSgDays(startOfWeek(date), 6);
}

/** The seven dates of the week containing `date`, Monday first. */
export function weekGrid(date) {
  const start = startOfWeek(date);
  return Array.from({ length: 7 }, (_, i) => addSgDays(start, i));
}

/** First and last day of a YYYY-MM month. */
export function monthBounds(ym) {
  const [y, m] = ym.split("-").map(Number);
  const first = `${ym}-01`;
  // Day 0 of the NEXT month is the last day of this one — the standard trick,
  // done in UTC so it cannot drift, then read back as a plain date string.
  const lastDay = new Date(Date.UTC(m === 12 ? y + 1 : y, m === 12 ? 0 : m, 0)).getUTCDate();
  return { first, last: `${ym}-${String(lastDay).padStart(2, "0")}` };
}

/**
 * The month as whole weeks, Monday first, padded with the neighbouring months'
 * days so every row has seven cells.
 *
 * Returns `[{ date, inMonth }]` rows. The padding days are real dates and do
 * carry their shifts: a Sunday class on the 30th does not stop mattering
 * because the grid has rolled over to October.
 */
export function monthGrid(ym) {
  const { first, last } = monthBounds(ym);
  const start = startOfWeek(first);
  const weeks = [];
  let cursor = start;
  // At most six rows: 31 days plus up to six days of leading padding is 37,
  // which never exceeds six weeks.
  for (let w = 0; w < 6; w++) {
    const row = Array.from({ length: 7 }, (_, i) => {
      const date = addSgDays(cursor, i);
      return { date, inMonth: date >= first && date <= last };
    });
    weeks.push(row);
    cursor = addSgDays(cursor, 7);
    if (cursor > last) break;
  }
  return weeks;
}

/** The fetch range a view needs — the padded grid, not just the month. */
export function rangeFor(view, anchor) {
  if (view === "week") {
    const days = weekGrid(anchor);
    return { from: days[0], to: days[6] };
  }
  const weeks = monthGrid(anchor.slice(0, 7));
  return { from: weeks[0][0].date, to: weeks[weeks.length - 1][6].date };
}

/** Step a month or a week forward or back, returning a YYYY-MM-DD anchor. */
export function step(view, anchor, delta) {
  if (view === "week") return addSgDays(anchor, 7 * delta);
  const [y, m] = anchor.slice(0, 7).split("-").map(Number);
  const total = y * 12 + (m - 1) + delta;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  // Clamp the day so stepping from the 31st never lands on a date that does not
  // exist — March 31 back one month is February, not March 3.
  const ym = `${ny}-${String(nm).padStart(2, "0")}`;
  const { last } = monthBounds(ym);
  const day = Math.min(Number(anchor.slice(8, 10)), Number(last.slice(8, 10)));
  return `${ym}-${String(day).padStart(2, "0")}`;
}

export function todayAnchor() {
  return sgToday();
}

/** Group shifts by their Singapore date, for O(1) lookup per cell. */
export function byDate(shifts) {
  const out = {};
  for (const s of shifts || []) {
    const key = s.date || sgDate(s.startsAt);
    (out[key] ||= []).push(s);
  }
  for (const key of Object.keys(out)) {
    out[key].sort((a, b) => String(a.startsAt).localeCompare(String(b.startsAt)));
  }
  return out;
}

// ---- Colour ------------------------------------------------------------
//
// Sling colours a shift by POSITION, which is what makes a dense month legible
// at a glance — you are looking for "is there a lead teacher at Tampines on the
// 12th", not reading 373 rows. The same idea, with the portal's palette.
//
// Keyed on a derived role rather than the raw position string, because the
// imported positions are free text ("LEAD TEACHER (ARS)", "Lead Teacher") and
// three spellings of one job should not be three colours.

export const ROLE_COLOURS = {
  lead: { bg: "bg-[#E8927C]", text: "text-white", label: "Lead teacher" },
  assistant: { bg: "bg-[#8B7BA8]", text: "text-white", label: "Assistant teacher" },
  intern: { bg: "bg-[#A8916F]", text: "text-white", label: "Intern" },
  teaching: { bg: "bg-[#7BA88B]", text: "text-white", label: "Teaching" },
  mentoring: { bg: "bg-[#6FA3B8]", text: "text-white", label: "Mentoring" },
  it: { bg: "bg-[#5E8C9E]", text: "text-white", label: "IT" },
  curriculum: { bg: "bg-[#B8916F]", text: "text-white", label: "Curriculum" },
  events: { bg: "bg-[#C08A9E]", text: "text-white", label: "Events" },
  logistics: { bg: "bg-[#8A9EC0]", text: "text-white", label: "Logistics" },
  ot: { bg: "bg-[#9E9E8A]", text: "text-white", label: "Ad-hoc / OT" },
  cancelled: { bg: "bg-line", text: "text-charcoal-soft", label: "Cancelled" },
};

/**
 * Which colour bucket a shift belongs to.
 *
 * Cancelled wins over everything: a cancelled shift greys out whatever it was,
 * because the question being asked of a grey block is "is this happening?" and
 * the answer is no.
 */
export function roleOf(shift) {
  if (!shift) return "teaching";
  if (shift.status === "cancelled") return "cancelled";
  if (shift.category === "ot") {
    const r = String(shift.otRole || "").toLowerCase();
    return ROLE_COLOURS[r] ? r : "ot";
  }
  // The SHIFT's position first, the person's job title second. A lead teacher
  // covering an assistant's class is working an assistant-teacher shift, and
  // only the shift knows that; the profile title is the fallback for the back
  // catalogue, which was imported before positions were stored per shift.
  const p = String(shift.position || shift.teacherPosition || "").toUpperCase();
  if (p.includes("INTERN")) return "intern";
  if (p.includes("LEAD")) return "lead";
  if (p.includes("ASSISTANT") || p.includes("ASST")) return "assistant";
  return "teaching";
}

/** The roles actually present, so the legend shows only what is on screen. */
export function legendFor(shifts) {
  const seen = new Set((shifts || []).map(roleOf));
  return Object.keys(ROLE_COLOURS).filter((k) => seen.has(k));
}
