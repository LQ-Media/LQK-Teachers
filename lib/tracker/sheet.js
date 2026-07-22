import "server-only";

/**
 * Server-side client for the LQK Google Sheet (via its Apps Script web app) —
 * the same backend the Shopify "Teacher's Quran Tracker" uses. Running this on
 * the server keeps the access token out of the browser (unlike the old theme
 * JS, where it was public).
 *
 * The URL + token default to the existing (already-public) values so the app
 * works out of the box, but set LQK_SHEET_URL / LQK_SHEET_TOKEN as environment
 * variables in production, and rotate the token in the Apps Script for real
 * security (it has been public in the Shopify theme).
 */
const SHEET_URL =
  process.env.LQK_SHEET_URL ||
  "https://script.google.com/macros/s/AKfycbxL2vyQWZbfEOrZWA-Z1vhhiDB0cCCmgaqUEIorDJ_lrbAZVTwRyyjJ1r5906r6rYMvwA/exec";
const TOKEN = process.env.LQK_SHEET_TOKEN || "LQK-Teacher-App";

/** Singapore (UTC+8) calendar date as YYYY-MM-DD. */
export function sgToday() {
  const n = new Date();
  const sg = new Date(n.getTime() + (n.getTimezoneOffset() + 480) * 60000);
  const m = sg.getMonth() + 1;
  const d = sg.getDate();
  return `${sg.getFullYear()}-${m < 10 ? "0" : ""}${m}-${d < 10 ? "0" : ""}${d}`;
}

async function getJson(params) {
  const res = await fetch(`${SHEET_URL}?token=${encodeURIComponent(TOKEN)}&${params}`, {
    headers: { Accept: "application/json" },
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sheet request failed (${res.status})`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "Sheet error");
  return j;
}

/** Students in a class, with today's logged status and last-read (from the Sheet). */
export async function sheetRoster(cls) {
  const j = await getJson(`action=roster&cls=${encodeURIComponent(cls)}&date=${sgToday()}`);
  return j.students || [];
}

/** Full lesson history for a student. */
export async function sheetHistory(sid) {
  const j = await getJson(`action=history&sid=${encodeURIComponent(sid)}`);
  return j.lessons || [];
}

/** Append a lesson (writes back to the Sheet, matching the original payload shape). */
export async function sheetSaveLesson({ sid, cls, surah, from, to, sabaq, grade, note }) {
  const body = {
    action: "lesson",
    token: TOKEN,
    date: sgToday(),
    cls,
    sid,
    att: "p",
    log: { sabaq, gSabaq: grade, gSabqi: "", gManzil: "", slips: 0, note, surah, from, to },
  };
  const res = await fetch(SHEET_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(body),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`Sheet write failed (${res.status})`);
  const j = await res.json();
  if (!j.ok) throw new Error(j.error || "Sheet write error");
  return j;
}
