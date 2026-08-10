/**
 * Set each account's work-hours pay tier from the JULY payroll sheet.
 *
 * Source: "PAYMENT DETAILS" spreadsheet, JULY tab, column "TEACHING RATE"
 *   https://docs.google.com/spreadsheets/d/1ccHFfE6xgXdxhaAbKb99bwbO82Sfl5kDYOgoX-9cZMQ
 * Accounts are matched on the sheet's "Email:" column, lowercased — every JULY
 * row matched a portal account by email alone except the two noted at the
 * bottom of RATES, which have no portal account yet.
 *
 * Unlike backfill-pay-tiers.mjs (which only fills NULLs from the free-text
 * position), this OVERWRITES the tier so the sheet is the source of truth.
 *
 * Safe by design:
 *   - Dry run by default. Pass --apply to actually write.
 *   - Only touches the 70 emails listed below. Anyone not in the sheet's
 *     TEACHING RATE column — Founders, HQ heads, the two $300/mth interns —
 *     is left exactly as-is and listed as "untouched".
 *   - Idempotent: re-running writes nothing once the tiers already match.
 *   - Only the four ladder rates (10/15/20/25) map to a tier; anything else
 *     is refused loudly rather than guessed at.
 *
 * Usage (run in the same environment as the app, i.e. same LQK_DATA_DIR):
 *   node scripts/sync-rates-from-july.mjs            # preview only
 *   node scripts/sync-rates-from-july.mjs --apply    # write the changes
 */

// getDb() seeds demo accounts unless NODE_ENV is production — never do that here.
if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";

import { getDb } from "../lib/db.js";
import { PAY_TIERS, TIER_BY_KEY } from "../lib/hours/rates.js";

/** $/hr from the sheet -> pay tier key. The ladder is the one in rates.js. */
const TIER_FOR_RATE = new Map(PAY_TIERS.map((t) => [t.rate, t.key]));

/** JULY sheet: lowercased email -> TEACHING RATE in $/hr. */
const RATES = new Map([
  ["ainulbina@gmail.com", 15],  // AINUL BINA ABDUL LATHEEF
  ["almakayzack@gmail.com", 15],  // ALMAHEERAH BINTE KAMARUZAMAN
  ["azimahm04@gmail.com", 15],  // AZIMAH BINTI MUHAMED JOHIR USAN
  ["dnahkhairiah@gmail.com", 20],  // DINAH KHAIRIAH BINTE AZMAN SHAH
  ["dmy4rh@gmail.com", 10],  // DINIE MAISARAH
  ["faazilahjaveedmaliq@gmail.com", 15],  // FAAZILAH BINTE JAVEED MALIQ
  ["adibahhhhhkhairuddin@gmail.com", 20],  // FARAH ADIBAH BINTE AHMAD KHAIRUDDIN
  ["farrjanna@gmail.com", 20],  // FARJANA MUSTARY
  ["fad_epchy@hotmail.com", 20],  // FATIMAH ZAHRA BINTE HAJI SUHAIMY
  ["fatimahzahraaa09@gmail.com", 20],  // FATIMAH ZAHRA BINTE SYED HUSAIN
  ["firzanahairulisham@gmail.com", 15],  // FIRZANA BINTE HAIRUL ISHAM
  ["brknsdsl@gmail.com", 15],  // FIRZANAH ABIRAH BINTE AFENDI
  ["m.a.onlinestoresg@gmail.com", 15],  // HUMAIRAH BINTI ABDUL AZIZ
  ["husna08shafiqah@gmail.com", 10],  // HUSNA SHAFIQAH BINTE SAZALI
  ["izyanliana09@icloud.com", 25],  // IZYAN LIANA BINTE ZULKEPLI
  ["knisaa1308@gmail.com", 25],  // KHAIRUNNISAA’ BTE SHARIL
  ["mariahshrfnfeeroz@gmail.com", 20],  // MARIAH SHARFINA FEEROZ SHAH
  ["mellishabinteerwan@gmail.com", 20],  // MELLISHA BINTE ERWAN
  ["deraismail88@gmail.com", 15],  // NADHIRAH BINTE ISMAIL
  ["nadyneeshal26@gmail.com", 15],  // NADYNE E’SHAL BTE NOER HADZLY
  ["nashirah.shamsudeen@gmail.com", 20],  // NASHIRAH BINTE SHAMSUDEEN
  ["nina.cckps17@gmail.com", 20],  // NINA SHAMEERA BINTE OSMAN
  ["noorfirthaus07@gmail.com", 15],  // NOOR FIRTHAUS D/O HASSALI
  ["noralizaa205@gmail.com", 20],  // NORALIZA BINTE ABDUL RASHID
  ["nsyahabd@gmail.com", 15],  // NUR AISYAH BINTE AHMAD DAHLAN
  ["faiqah110796@gmail.com", 15],  // NUR FAIQAH BTE RAIS
  ["faizahselamat@gmail.com", 15],  // NUR FAIZAH BINTE SELAMAT
  ["mjr.nurfarzanaabdullah@gmail.com", 20],  // NUR FARZANA ABDULLAH ABDULLAH
  ["nhxddy96@gmail.com", 20],  // NUR HIDAYAH BINTE SAMSURI
  ["nurhumaira807@gmail.com", 15],  // NUR HUMAIRA D/O MOHAMED HAJALI
  ["iffahmstrna@gmail.com", 10],  // NUR IFFAH MASTURINA BINTE AHMAD JAMAL
  ["myamarish12@gmail.com", 15],  // NUR MYA MARISHA NG BINTE MUHAMMAD NG
  ["nsabrinarahim@gmail.com", 25],  // NUR SABRINA BINTE RAHIM
  ["nrshafiqa17@gmail.com", 15],  // NUR SHAFIQA BINTE MOHAMAD NIZAM
  ["funnursu@gmail.com", 25],  // NUR SUHAILI BINTE MD SAID
  ["nurrummairah@gmail.com", 20],  // NUR UMMAIRAH BINTE NOR HISHAM
  ["nuratiqah0aizime@gmail.com", 15],  // NURATIQAH BINTE AIZIME
  ["hidayaharis022@gmail.com", 20],  // NURUL HIDAYAH BINTE MOHD ARIS
  ["nurulnaj312@gmail.com", 15],  // NURUL NAJIHAH BINTE MUHAMMAD FAISALAZIZ
  ["nvrynzainal17@gmail.com", 15],  // NURYN BINTE ZAINAL
  ["nusaybahhusayn@gmail.com", 25],  // NUSAYBAH BINTE MUHAMMAD HUSAYN
  ["qistinaaffendi@gmail.com", 20],  // QISTINA BATRISYIA BINTE AFFENDI
  ["rehanafarvin1108@gmail.com", 20],  // REHANA FARVIN D/O ABDUL RAVOOF
  ["riyanaazmi@gmail.com", 15],  // RIYANA AZMI D/O SYED MARICAR SALEEM
  ["ruhibinte08@gmail.com", 20],  // RUHI BINTE SYED
  ["skhoirunnisa2@gmail.com", 15],  // SALMAA KHOIRUNNISA
  ["sania021145@gmail.com", 15],  // SANIA
  ["nadiahalhadad@gmail.com", 20],  // SHARIFAH NADIAH BINTE SYED AHMAD ALHADAD
  ["sharina4036@gmail.com", 15],  // SHARINA BINTE SHAIK FAREED
  ["srfyna.s07@gmail.com", 15],  // SHERYN SORFYNA BINTE ABDUL SAINI
  ["izaahrly@gmail.com", 10],  // SITI HAMIZAH BTE ANWAR
  ["myrahummy@gmail.com", 25],  // SITI HUMAIRAH BINTE ANWAR
  ["snadbhr@gmail.com", 15],  // SITI NADHIRAH BINTE HAJI RAHMAN
  ["snainbs@gmail.com", 20],  // SITI NUR AIN BINTE SENIN
  ["learningthroughteaching267@gmail.com", 20],  // SITI RADHIAH BINTE HAMZAH
  ["suhana.atanan@gmail.com", 20],  // SITI SUHANA BINTE ATANAN
  ["ctsbr19@gmail.com", 15],  // SITI SYAFIYYAH BINTE RAHMAT
  ["zulyha04@gmail.com", 25],  // SITI ZULAIHA BINTE SAMSUKAMAR
  ["khuurineen@icloud.com", 25],  // SOFI KHURIN’EEN BTE MOHD AZMAN
  ["sofiyanurliyanamd@gmail.com", 15],  // SOFIYA NUR LIYANA BINTE MUHAMAD
  ["syfqhhusna@gmail.com", 25],  // SYAFIQAH HUSNA BINTE SHAHUL HAMED
  ["syasyasyafiqahmohdnazir@gmail.com", 15],  // SYASYA SYAFIQAH BINTE MOHD NAZIR
  ["syehevinazanna@gmail.com", 20],  // SYEHNAZ EVIANNA BINTE MOHAMED FAUZI
  ["udai.lifestories@gmail.com", 20],  // UDAIMATUNNUR BINTE AZMAN
  ["hanisahharun09@gmail.com", 20],  // UMI HANISAH BINTE MOHAMED HARUN
  ["ummwafeeqa@gmail.com", 20],  // UMMUL WAFEEQA NUHA BTE ABDUL WAHID
  ["zfirah0201@gmail.com", 25],  // ZAFIRAH BINTE ZANUDIN
  ["izahhh96@gmail.com", 15],  // ZAINAB BTE MOHAMMED OSMAN

  // In the JULY sheet with a rate, but no portal account as of this writing.
  // Left here so the tier lands automatically once they sign up.
  ["asirasafrinma@gmail.com", 15],  // MADAWAI ABDUL SALAM ASIRASAFRIN
  ["nurfarzanarhmn@gmail.com", 20],  // NUR FARZANA BINTE MOHD RAHMAN
]);

const apply = process.argv.includes("--apply");
const db = getDb();

const rows = db.prepare("SELECT id, full_name, email, position, pay_tier FROM profiles ORDER BY full_name").all();

const planned = [];
const unchanged = [];
const untouched = [];
const seen = new Set();

for (const r of rows) {
  const email = (r.email || "").trim().toLowerCase();
  const rate = RATES.get(email);
  if (rate === undefined) {
    untouched.push(r);
    continue;
  }
  seen.add(email);
  const tier = TIER_FOR_RATE.get(rate);
  if (!tier) throw new Error(`${r.full_name}: $${rate}/hr is not one of the ${PAY_TIERS.length} pay tiers`);
  if (r.pay_tier === tier) unchanged.push(r);
  else planned.push({ ...r, tier, rate });
}

const missing = [...RATES.keys()].filter((e) => !seen.has(e));

const label = (key) => (key ? `${TIER_BY_KEY[key].short} ($${TIER_BY_KEY[key].rate}/hr)` : "(not set)");

console.log(`\n${apply ? "APPLYING" : "DRY RUN — no changes written (pass --apply to write)"}\n`);
console.log(
  `Accounts: ${rows.length}   in JULY sheet: ${seen.size}   changing: ${planned.length}   already correct: ${unchanged.length}   not in sheet: ${untouched.length}\n`,
);

console.log("Changing:");
if (planned.length === 0) console.log("  (none)");
for (const p of planned) {
  console.log(`  ${p.full_name.padEnd(42)} ${label(p.pay_tier).padEnd(22)} -> ${label(p.tier)}`);
}

console.log("\nNot in the JULY sheet's TEACHING RATE column — left untouched:");
if (untouched.length === 0) console.log("  (none)");
for (const u of untouched) {
  console.log(`  ${u.full_name.padEnd(42)} ${label(u.pay_tier).padEnd(22)} ${u.position || "(no position)"}`);
}

console.log("\nIn the JULY sheet but no portal account with that email:");
if (missing.length === 0) console.log("  (none)");
for (const e of missing) console.log(`  ${e} — $${RATES.get(e)}/hr`);

if (!apply) {
  console.log("\nNothing written. Re-run with --apply to commit these changes.\n");
} else {
  const stmt = db.prepare("UPDATE profiles SET pay_tier = ? WHERE id = ?");
  for (const p of planned) stmt.run(p.tier, p.id);
  console.log(`\nWrote ${planned.length} pay tier${planned.length === 1 ? "" : "s"}.\n`);
}
