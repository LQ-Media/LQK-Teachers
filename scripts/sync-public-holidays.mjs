/**
 * Import Singapore public holidays into the portal.
 *
 * Source: MOM's official dataset on data.gov.sg (consolidated, 2020 onwards)
 *   https://data.gov.sg/datasets/d_8ef23381f9417e4d4254ee8b4dcdb176/view
 *
 * Why they're stored rather than fetched on demand: a shift on a public holiday
 * pays a multiplier (PH_MULTIPLIER in lib/hours/rates.js), so a lookup that
 * quietly failed would underpay someone. Payroll never reaches the network.
 *
 * Safe by design:
 *   - Dry run by default. Pass --apply to actually write.
 *   - Additive: inserts new dates and corrects renamed ones, never deletes.
 *     A holiday removed upstream stays put, because shifts may already be
 *     rostered and priced against it — remove those by hand, deliberately.
 *   - Idempotent: re-running once in sync writes nothing.
 *
 * Run it whenever MOM publishes the next year (they run about a year ahead).
 *
 * Usage (same environment as the app, i.e. same LQK_DATA_DIR):
 *   node scripts/sync-public-holidays.mjs            # preview only
 *   node scripts/sync-public-holidays.mjs --apply    # write the changes
 */

// getDb() seeds demo accounts unless NODE_ENV is production — never do that here.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

import { getDb } from "../lib/db.js";
import { fetchHolidays } from "../lib/hours/holidays.js";

const apply = process.argv.includes("--apply");

const holidays = await fetchHolidays();
const db = getDb();

const existing = new Map(
  db.prepare("SELECT date, name FROM public_holidays").all().map((r) => [r.date, r.name])
);

const added = [];
const renamed = [];
for (const h of holidays) {
  const was = existing.get(h.date);
  if (was === undefined) added.push(h);
  else if (was !== h.name) renamed.push({ ...h, was });
}

console.log(`Fetched ${holidays.length} holidays (${holidays[0].date} → ${holidays[holidays.length - 1].date})`);
console.log(`Already stored: ${existing.size}`);
console.log(`New:            ${added.length}`);
console.log(`Renamed:        ${renamed.length}`);

for (const h of added) console.log(`  + ${h.date}  ${h.name}`);
for (const h of renamed) console.log(`  ~ ${h.date}  ${h.was} → ${h.name}`);

const stale = [...existing.keys()].filter((d) => !holidays.some((h) => h.date === d));
if (stale.length) {
  console.log(`\n${stale.length} stored date(s) are not in the feed — left untouched, remove by hand if wrong:`);
  for (const d of stale) console.log(`  ? ${d}  ${existing.get(d)}`);
}

if (!added.length && !renamed.length) {
  console.log("\nAlready in sync — nothing to write.");
  process.exit(0);
}

if (!apply) {
  console.log("\nDry run. Re-run with --apply to write.");
  process.exit(0);
}

const now = new Date().toISOString();
const insert = db.prepare("INSERT INTO public_holidays (date, name, created_at) VALUES (?, ?, ?)");
const rename = db.prepare("UPDATE public_holidays SET name = ? WHERE date = ?");
for (const h of added) insert.run(h.date, h.name, now);
for (const h of renamed) rename.run(h.name, h.date);

console.log(`\nWrote ${added.length} new and ${renamed.length} renamed holiday(s).`);
