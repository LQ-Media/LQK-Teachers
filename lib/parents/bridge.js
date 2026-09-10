import "server-only";

/* The parents portal, from this side.

   parents.littlequrankids.sg owns enrolment: which children are in which
   class, at which branch, with which teacher. This portal has never held a
   children roster (the `students` table here is the STAFF hifz roster). So
   "my classes" is answered by asking the parents portal over a small signed
   API — see lib/bridge.js in LQK-Parents — and after-lesson reports go back
   the same way, landing in each child's feed on the family's Home.

   Both env vars are optional. Without them the page explains that the link
   is not set up rather than failing, so a deploy is never blocked on it. */

export function parentsConfigured() {
  return !!(process.env.LQK_PARENTS_URL && process.env.LQK_PARENTS_TOKEN);
}

function base() {
  return String(process.env.LQK_PARENTS_URL || "").replace(/\/+$/, "");
}

async function call(path, init = {}) {
  if (!parentsConfigured()) return { ok: false, skipped: true, error: "The parents portal link is not set up." };
  try {
    const res = await fetch(`${base()}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${process.env.LQK_PARENTS_TOKEN}`,
        "Content-Type": "application/json",
        ...(init.headers || {}),
      },
      cache: "no-store",
      signal: AbortSignal.timeout(12000),
    });
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return { ok: false, error: `The parents portal answered ${res.status} with something that is not JSON.` };
    }
    if (!res.ok || !body?.ok) return { ok: false, error: body?.error || `The parents portal answered ${res.status}.` };
    return body;
  } catch (err) {
    return { ok: false, error: err?.name === "TimeoutError" ? "The parents portal did not answer in time." : err?.message || "network error" };
  }
}

/**
 * Classes with their confirmed children. A teacher gets the classes matched
 * to their email or name; `all` (admins, assessors) gets every class.
 */
export async function fetchClasses({ email, name, all = false, year = null }) {
  const q = new URLSearchParams();
  if (all) q.set("all", "1");
  else {
    if (email) q.set("email", email);
    if (name) q.set("name", name);
  }
  if (year) q.set("year", String(year));
  const r = await call(`/api/bridge/roster?${q.toString()}`);
  return r.ok ? { ok: true, classes: r.classes || [] } : r;
}

export async function sendClassReport(payload) {
  return call("/api/bridge/feed", { method: "POST", body: JSON.stringify(payload) });
}

export async function updateChild(childId, payload) {
  return call(`/api/bridge/children/${encodeURIComponent(childId)}`, { method: "PATCH", body: JSON.stringify(payload) });
}
