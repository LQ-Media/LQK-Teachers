// Who holds which tier of admin access, and how a name on Karim's list is
// matched to an account.
//
// This module is PURE — no database, no server imports — for one reason: it is
// used from two places that must never disagree. The script
// (scripts/set-admin-scopes.mjs) and the Admin → Access panel both resolve the
// same list with the same matcher. Two copies of a name-matching rule is two
// answers to "does Khairunnisaa' have access", and only one of them would be
// right.
//
// The list itself lives in code rather than in the schema because it is an
// operational decision that changes as people join and leave — and because a
// name in source is a name somebody has to remember to delete.

/** Full access: payroll, every centre, everything. Karim, 16 Sep 2026. */
export const FULL_ADMINS = [
  "Nur Abdul Karim",
  "Siti Suaidah",
  "Nurul Iman Fatimah",
  "Siti Malia",
];

/**
 * Centre IT Heads: their own centres' shifts, clock-in adjustments, missed
 * shifts and the relief board. No payroll at all.
 */
export const CENTRE_ADMINS = [
  ["ZAFIRAH BINTE ZANUDIN", ["Woods Square"]],
  ["NUR SABRINA BINTE RAHIM", ["Primz Bizhub"]],
  ["KHAIRUNNISAA' BTE SHARIL", ["Tampines Blk 462", "Tampines Junction"]],
  ["SITI ZULAIHA BINTE SAMSUKAMAR", ["Primz Bizhub"]],
  ["NUR AISYAH BINTE AHMAD DAHLAN", ["Tampines Blk 462", "Tampines Junction"]],
  ["MELLISHA BINTE ERWAN", ["Woods Square"]],
  ["NADIAH BINTE MOHAMMAD SALAM", ["Woods Square"]],
];

/**
 * Fold a name to one comparable form.
 *
 * Apostrophes are the thing that will silently break this. KHAIRUNNISAA' can be
 * typed with a straight quote, a curly one, a modifier letter or an accent, and
 * those are four different characters. A mismatch reports NO MATCH and quietly
 * leaves an IT Head without the access they were promised — which nobody
 * notices until they try to use it.
 */
export function fold(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[‘’ʼ`´]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

/** Everyone whose full name contains every word of the query. */
export function findByName(people, query) {
  const words = fold(query).split(" ").filter(Boolean);
  if (!words.length) return [];
  return people.filter((p) => {
    const name = fold(p.full_name ?? p.fullName);
    return words.every((w) => name.includes(w));
  });
}

/**
 * Work out what would change, without changing anything.
 *
 * `people` is every profile: {id, full_name, email, role, admin_scope}.
 * Returns `{ plan, problems }`.
 *
 * DELIBERATELY CAUTIOUS. A name matching nobody, or more than one person, is
 * REPORTED AND SKIPPED rather than guessed at. Handing the wrong person payroll
 * access is not a mistake worth risking to save a minute of typing, and the
 * whole value of a dry run is that it refuses to be clever.
 */
export function resolveScopePlan(people, branches = []) {
  const plan = [];
  const problems = [];

  const resolve = (query) => {
    const hits = findByName(people, query);
    if (hits.length === 0) {
      problems.push({ kind: "no_match", query, detail: "Nobody with that name has an account." });
      return null;
    }
    if (hits.length > 1) {
      problems.push({
        kind: "ambiguous",
        query,
        detail: `Matches ${hits.length}: ${hits.map((h) => `${h.full_name ?? h.fullName} <${h.email}>`).join(", ")}`,
      });
      return null;
    }
    return hits[0];
  };

  for (const name of FULL_ADMINS) {
    const p = resolve(name);
    if (!p) continue;
    plan.push({
      id: p.id,
      name: p.full_name ?? p.fullName,
      email: p.email,
      scope: "full",
      branches: [],
      was: describeCurrent(p),
      changes: p.role !== "admin" || p.admin_scope !== "full",
    });
  }

  for (const [name, wanted] of CENTRE_ADMINS) {
    const bad = branches.length ? wanted.filter((b) => !branches.includes(b)) : [];
    if (bad.length) {
      problems.push({ kind: "bad_branch", query: name, detail: `${bad.join(", ")} is not a known branch.` });
      continue;
    }
    const p = resolve(name);
    if (!p) continue;
    plan.push({
      id: p.id,
      name: p.full_name ?? p.fullName,
      email: p.email,
      scope: "centre",
      branches: wanted,
      was: describeCurrent(p),
      changes: true, // branches are rewritten wholesale, so this always writes
    });
  }

  return { plan, problems };
}

function describeCurrent(p) {
  if (p.role !== "admin") return `not an admin (${p.role})`;
  return p.admin_scope === "full" ? "full access" : "centre access";
}
