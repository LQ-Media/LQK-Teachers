# LQK Teachers Portal — handoff

Written 2026-08-10. For a new person (or a fresh Claude account) picking this up cold.

The portal is **live and in daily use by ~77 staff** at <https://teachers.littlequrankids.sg>. It is not a prototype. Treat production data as real: it holds actual staff accounts and actual payroll hours.

---

## 1. State at handoff

| | |
|---|---|
| Repo | `git@github.com:LQ-Media/LQK-Teachers.git`, branch `main` |
| HEAD | `86ae263` — clean tree, local and origin in sync |
| Host | Railway project **pure-wisdom** → service **LQK-Teachers**, region sfo |
| Volume | `lqk-teachers-volume` mounted at `/data`, ~52 MB of 500 MB |
| Deploys | Automatic on push to `main` |
| Stack | Next.js 16.2.9 (App Router, server actions), Node 26, SQLite via built-in `node:sqlite` |

**Most recently shipped:** an optional location stamp on Ad-hoc / OT work sessions (`168951a`). Deployed and healthy. Details in §4.

There is no staging environment. `main` is production.

---

## 2. What you need from Karim

None of this is self-serviceable — ask for it before you start:

- **Push access** to `LQ-Media/LQK-Teachers`
- **Railway access** to the `pure-wisdom` project (for logs, variables, rollbacks)
- **A login for the live portal** if you need to verify anything end-to-end in production. Do not test with a real teacher's account, and do not reset a real teacher's password to get in.
- **`LQK_HQ_CODE`** if you need to register a new admin account
- Optional: `GROQ_API_KEY` / `GEMINI_API_KEY` if you're touching the Halaqah Notebook

Secrets live in Railway service variables and in a local `.env.local` — never in the repo. `.env.example` documents every variable and how to generate the ones that need generating.

---

## 3. Running it locally

```bash
npm ci && cp .env.example .env.local
```

Set `SESSION_SECRET` in `.env.local` (the file tells you the exact command to generate one). Leave `LQK_DATA_DIR` unset locally — it defaults to `./data`.

```bash
npm run dev
```

**Logging in locally is the first thing that will trip you up.** The login page advertises demo accounts (`teacher@lqk.test` / `password123`). On a fresh empty database those work, because `seedIfEmpty` creates them. On **Karim's laptop they do not** — that dev DB is a copy of production with ~77 real profiles, so the seed never fires and the hint text is stale.

If you're handed a copy of that DB, use the throwaway admin `claude-test@lqk.test` and set its password yourself:

```bash
node --input-type=module -e "
import { DatabaseSync } from 'node:sqlite';
import { hashPassword } from './lib/hash.js';
new DatabaseSync('data/lqk.db').prepare('UPDATE profiles SET password_hash = ? WHERE email = ?')
  .run(hashPassword('CHOOSE-YOUR-OWN'), 'claude-test@lqk.test');"
```

If you're starting from an empty `data/` instead, just let it seed and use the demo accounts.

---

## 4. The work-hours feature (and the geolocation stamp)

This is the payroll path. It replaced Skooly for logging teacher time, so **bugs here cost people money**. Read `lib/hours/rates.js` before changing anything in it.

### Pay model

All rates live in `lib/hours/rates.js` — edit there, nowhere else.

- Teaching pays the teacher's tier on their profile: `asst_probation` $10 / `asst` $15 / `lead` $20 / `lead_ars` $25
- Ad-hoc / OT is a flat **$10/hr** for everyone
- Approved sessions **snapshot `rate_cents`**, so a later tier change never rewrites past payroll. Pending pay is only an estimate.
- All times are Singapore (UTC+8) via the Intl helpers in `rates.js`
- Teaching hours **cannot be approved until the teacher's pay tier is set** — this is a deliberate guard, not a bug

### Location stamp (shipped 2026-08-10)

OT is worked wherever the job is — a centre being cleaned, an event venue — so a teacher can stamp an OT session with one reading from their device.

**These are deliberate design decisions. Do not "improve" them without asking Karim:**

- **One point, captured on a tap.** Nothing is sampled while the timer runs. There is no background watch. This is a location *stamp*, not tracking, and it was scoped that way on purpose.
- **Optional.** An untagged session is always valid and always payable. Nothing is gated on it.
- **OT only.** The control is hidden for Class teaching, which already happens at a known branch.
- **The label is resolved once, server-side, at capture time** and stored on the row. Payroll views never call a geocoder — that keeps the admin screen fast and stays inside Nominatim's usage policy. It also means a client cannot dictate the stored label.
- **A failed lookup is not an error.** The coordinates are the record; the place name is a courtesy.
- **`GEO_ATTRIBUTION` ("Places © OpenStreetMap contributors") must stay wherever labels render.** That is the OSM licence condition, not decoration.

Files: `lib/hours/geo.js` (validation, formatting, reverse geocoding) and `components/hours/LocationTag.js` (the device-side control plus a read-only `LocationLine`). Storage is five additive columns on `work_sessions` — `geo_lat`, `geo_lng`, `geo_accuracy`, `geo_label`, `geo_at`. Untagged is `NULL`.

### Where it all lives

| Concern | File |
|---|---|
| Rates, tiers, SG time helpers | `lib/hours/rates.js` |
| Geo helpers + Nominatim | `lib/hours/geo.js` |
| Server actions | `lib/actions/hours.js` |
| Teacher UI | `components/hours/HoursApp.js`, `app/(portal)/hours/page.js` |
| Location control | `components/hours/LocationTag.js` |
| Admin review | `components/admin/HoursAdmin.js` (3rd tab in `AdminApp`) |
| Monthly CSV | `app/api/hours/export/route.js?month=YYYY-MM` (admin-gated) |
| Schema + migrations | `lib/db.js` → `ensureSchema` |

### Monthly rate sync

Karim's source of truth for pay is the "PAYMENT DETAILS" Google Sheet, one tab per month. It is link-shared, so the public `gviz/tq?tqx=out:csv&sheet=<TAB NAME>` endpoint reads it without auth. `scripts/sync-rates-from-july.mjs` is the re-runnable importer — dry-run by default, `--apply` to write. Copy it per month and swap the rates map.

Two traps: only $10/15/20/25 are expressible (the portal stores a *tier*, not a free rate — anything else must be escalated to Karim, never rounded), and salaried staff (founders, HQ heads, the two $300/month interns) have a blank teaching rate and **must be left untouched**.

---

## 5. Verified vs not

**Verified locally**, on the code now in `main`: clean production build; the full `npm test` suite green (51 offline, plus 2 live-network tests when opted in); a live Nominatim lookup resolving a real Singapore address; and a full round trip of a tagged OT session appearing correctly in the teacher list, the admin approval queue, and the CSV export with label, coordinates, accuracy and map link.

The ad-hoc logic tests are now permanent — see §5a.

### 5a. The test suite

```bash
npm test
```

Node's built-in runner, no dependencies added, files in `test/*.test.mjs`. 51 tests over the two pure modules: `rates.js` (tiers, the flat OT rate, tier-from-position matching order, SG time boundaries, duration and rounding, money formatting) and `geo.js` (fix validation, null-island and accuracy-ceiling rejection, display helpers, label building).

Two things to know:

- **The live Nominatim round-trip is opt-in**, so the default run is offline and deterministic: `LQK_TEST_NETWORK=1 npm test`.
- Tests are `.mjs` deliberately. The repo has no `"type": "module"`, and setting one to tidy the `MODULE_TYPELESS_PACKAGE_JSON` warning would change module resolution for every plain `.js` file in the project — not worth it for a cosmetic warning.

The tests assert *rules*, not current output, and each says which rule it protects. If one goes red, the fix is almost never to update the expectation.

**Verified in production**: deploy succeeded, container healthy, `/login` 200, `/hours` redirects to login, the CSV route returns 401 rather than 500 for an unauthenticated caller.

**Not verified in production**: the actual capture flow. That needs a real login, which the previous session declined to do with staff credentials. **This is the top item for whoever picks this up.**

To close it: log in on a phone, start an Ad-hoc / OT session, tap "Tag my location", confirm the resolved address looks right, then check it appears in Admin → Work hours and in the month's CSV.

One thing to watch for specifically: **geolocation requires a secure context.** Over HTTPS on the live domain it is fine. If anyone tests by pointing a phone at a laptop's LAN address over plain `http://`, the browser silently never resolves the request — `LocationTag` detects this and shows an explanatory message rather than spinning, but it's still the most likely "it's broken" report you'll get.

---

## 6. Open items

1. **Production spot-check of the capture flow** (above) — highest priority.
2. **Nominatim load.** Fine today: tagging is rare and human-paced, requests are throttled to 1/sec and cached. If OT tagging becomes routine across all ~77 staff, revisit — the usage policy is aimed at exactly this kind of app, and a self-hosted or commercial geocoder is the escape hatch.
3. **No geofencing or validation.** A stamp records where the teacher's device says it was when they tapped. It is a record for the approving admin to eyeball, not proof. If Karim ever wants it to *enforce* anything (must be within X metres of a branch), that is a new feature and a very different conversation about staff trust — raise it with him first.
4. **`claude-test@lqk.test`** is a leftover admin account in the local dev DB with a known password. Harmless locally; delete it if you prefer. Confirm it does **not** exist in production.
5. **Test coverage stops at the pure helpers.** `npm test` covers `lib/hours/rates.js` and `lib/hours/geo.js`. It does **not** cover the server actions in `lib/actions/hours.js` — including the monthly totals in `hoursAdminData`, where approved sessions use their snapshotted `rate_cents` and pending ones use the teacher's current tier. That branch is the most valuable thing still untested, but covering it means either a DB fixture harness or extracting the aggregation into a pure function. The extraction is the tidier option and it touches payroll code, so agree it with Karim first.

---

## 7. Gotchas that will bite you

**Karim commits to this repo from other devices, mid-session.** This is the single most important operating rule. He did it twice during the session that shipped the geo feature. Always:

- `git pull --rebase` before you start and before you push
- **never `git add .`** — stage only the files you actually touched, by name. There will routinely be unrelated work-in-progress sitting in the tree that is his, not yours.
- if a rebase conflicts, read both sides; they're usually additive changes to the same import block and both need keeping

**`LQK_DATA_DIR=/data` is set as an `ENV` in the Dockerfile, not as a Railway variable.** It will not appear in `railway variables`. Do not "helpfully" add or change it — pointing it anywhere else moves the SQLite file off the mounted volume and every redeploy would then silently discard all data.

**Migrations are additive-only, applied at runtime** in `ensureSchema` (`lib/db.js`) via `ALTER TABLE ... ADD COLUMN` guarded by a `PRAGMA table_info` check. There is no migration framework and no down-migrations. Never rename or drop a column.

**This is Next.js 16**, which differs from what most models have memorised. `AGENTS.md` says it outright: read the relevant guide in `node_modules/next/dist/docs/` before writing code, rather than reaching for remembered conventions.

**`node:sqlite` rows have a null prototype.** Shape them into plain objects before handing them to a Client Component, or React will reject them. Every existing query does this — follow the `toSession` pattern in `lib/actions/hours.js`.

**The build emits one warning** about unexpected files in the NFT trace, pointing at `next.config.mjs`. It is pre-existing, caused by the dynamic imports in the dzikir loaders, and unrelated to anything recent. Don't chase it.

---

## 8. The rest of the portal, briefly

Beyond work hours, the portal routes are `dashboard`, `hafalan` (Quran tracker, Google-Sheet backed), `quran` (reader), `reading`, `review`, `dzikir` (Wirid & Doa / Maulid), `solat` (prayer times + azan with web push), `qibla`, `notebook` (AI-assisted Halaqah notebook), `ilmu`, `kalimah`, `packs` (lesson packs), `achievements`, `profile`, and `admin` (accounts, staff roster, invites).

It is installable as a PWA (service worker, manifest, install prompt). Deliberately, the service worker caches static assets only and **never authed data**. There is no native app-store presence; that would need a Capacitor/TWA wrapper and Karim supplying the paid developer accounts.

Auth is self-registration against an invited-emails allowlist, with the HQ code (`LQK_HQ_CODE`) as the only route to an admin role.

---

## 9. First hour

```bash
git clone git@github.com:LQ-Media/LQK-Teachers.git && cd LQK-Teachers
npm ci && cp .env.example .env.local   # then set SESSION_SECRET
npm run dev
```

Register an account, or seed a fresh DB and use the demo logins. Open `/hours`, switch the session type to **Ad-hoc / OT**, and you'll see the "Where are you? — Tag my location" control. On `localhost` it is a secure context, so capture works and you can watch the whole path: tap, see the resolved address, clock in, then look at Admin → Work hours and export the CSV.

Then read, in this order: `lib/hours/rates.js` (the money), `lib/actions/hours.js` (the writes), `lib/db.js` → `ensureSchema` (the shape).
