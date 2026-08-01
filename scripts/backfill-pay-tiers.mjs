/**
 * Backfill each account's work-hours pay tier from its free-text position.
 *
 * The Sheet import wrote positions like "LEAD TEACHER, EVENTS TEAM" or
 * "INTERN - ASSISTANT TEACHER"; this maps them onto the four pay tiers so
 * teaching hours can be costed without setting 76 tiers by hand.
 *
 * Safe by design:
 *   - Dry run by default. Pass --apply to actually write.
 *   - Only fills accounts whose pay_tier is NULL — never overwrites a tier an
 *     admin has already set, so it is safe to re-run.
 *   - Non-teaching roles (Founder, Finance Head, mentoring-only, Admin
 *     Assistant…) are left unset and listed as "skipped" for manual review.
 *
 * Usage (run in the same environment as the app, i.e. same LQK_DATA_DIR):
 *   node scripts/backfill-pay-tiers.mjs            # preview only
 *   node scripts/backfill-pay-tiers.mjs --apply    # write the changes
 */

// getDb() seeds demo accounts unless NODE_ENV is production — never do that here.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

import { getDb } from "../lib/db.js";
import { tierForPosition, TIER_BY_KEY } from "../lib/hours/rates.js";

const apply = process.argv.includes("--apply");
const db = getDb();

const rows = db.prepare("SELECT id, full_name, position, pay_tier FROM profiles ORDER BY full_name").all();

const planned = [];
const skipped = [];
const alreadySet = [];

for (const r of rows) {
  if (r.pay_tier) {
    alreadySet.push(r);
    continue;
  }
  const tier = tierForPosition(r.position);
  if (tier) planned.push({ ...r, tier });
  else skipped.push(r);
}

// Summary by tier.
const byTier = new Map();
for (const p of planned) byTier.set(p.tier, (byTier.get(p.tier) || 0) + 1);

console.log(`\n${apply ? "APPLYING" : "DRY RUN — no changes written (pass --apply to write)"}\n`);
console.log(`Accounts: ${rows.length}   already set: ${alreadySet.length}   to fill: ${planned.length}   skipped: ${skipped.length}\n`);

console.log("Will set:");
for (const [tier, count] of [...byTier].sort((a, b) => b[1] - a[1])) {
  const t = TIER_BY_KEY[tier];
  console.log(`  ${String(count).padStart(3)} × ${t.label} ($${t.rate}/hr)`);
}

console.log("\nSkipped — no teaching tier inferred, set manually if they teach:");
if (skipped.length === 0) console.log("  (none)");
for (const s of skipped) console.log(`  ${s.full_name} — ${s.position || "(no position)"}`);

if (alreadySet.length) {
  console.log(`\nLeft untouched (tier already set): ${alreadySet.length}`);
}

if (apply) {
  const stmt = db.prepare("UPDATE profiles SET pay_tier = ? WHERE id = ? AND pay_tier IS NULL");
  let n = 0;
  for (const p of planned) n += stmt.run(p.tier, p.id).changes;
  console.log(`\nDone — ${n} account(s) updated.`);
} else {
  console.log("\nNothing written. Re-run with --apply to commit these changes.");
}
