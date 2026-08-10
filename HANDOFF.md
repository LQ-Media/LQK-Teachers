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

- **Pay is the ROSTERED SHIFT**, not the clocked time. See §4a.
- Teaching pays the teacher's tier on their profile: `asst_probation` $10 / `asst` $15 / `lead` $20 / `lead_ars` $25
- Ad-hoc / OT is a flat **$10/hr** for everyone
- Work on a Singapore public holiday pays **`PH_MULTIPLIER` (currently 2) on the hourly rate**. Read the comment above the constant before changing it: MOM publishes no multiplier, the statutory rule is additive, and 2x is a deliberate approximation agreed with Karim.
- Approved sessions **snapshot `rate_cents` and `ph_multiplier`**, so a later tier or multiplier change never rewrites past payroll. Pending pay is only an estimate.
- All times are Singapore (UTC+8) via the Intl helpers in `rates.js`
- Teaching hours **cannot be approved until the teacher's pay tier is set** — this is a deliberate guard, not a bug

### 4a. Rostered shifts (shipped 2026-08-10)

Built from staff feedback: teachers were never meant to clock out or enter their own OT.

**How it works now.** Admins roster shifts ahead of time (Admin → Roster). A teacher opens the app and taps **clock in** — that is the whole teacher-facing action. There is no clock out, because teachers forget and an open session leaves nobody knowing when they finished.

**These are decisions, not accidents. Check with Karim before changing any of them:**

- **Pay = the rostered shift.** A session copies the shift's window into `started_at`/`ended_at` when it is created. `clock_in_at` records when they actually tapped; **lateness is deliberately never flagged**.
- **One tap covers a whole back-to-back BLOCK** of shifts (gap ≤ 30 min). Without this, a teacher who taps once before three consecutive classes would be chased for missing two of them, and the weekly report would stop being believed.
- **Unscheduled clock-in is allowed**, left genuinely open, and flagged for an admin to close. A gap in the roster must never stop someone being paid, and **the system never invents an end time** — hence no background job anywhere in this feature.
- **Shifts are cancelled, never deleted.** `work_sessions.shift_id` is a real FK with no `ON DELETE`, so deleting a worked shift throws. Bulk delete reports what it kept.
- **A missed shift asks the teacher for a reason**; an admin then pays it or rejects it. A rejected one is remembered so the report stops asking.
- **OT is inserted by an admin** as an OT *shift* after MH approves it. Teachers can no longer self-enter sessions or edit a rostered one — that would be editing their own pay.

**The rule that keeps the money right:** a rostered session carries a **future `ended_at`** for the whole shift, so `ended_at IS NOT NULL` no longer means "this happened". Every payroll reader tests **`ended_at <= now`** — `lib/actions/hours.js` (queue, totals, and a hard guard in `approveSession`), both portal pages, and the CSV route. Miss it in a new reader and you will pay for classes that haven't been taught.

**Public holidays** come from MOM's official dataset on data.gov.sg, imported by `scripts/sync-public-holidays.mjs` (re-runnable, dry-run by default). Run it when MOM publishes a new year. Shifts on those dates are stamped and pay the multiplier; the bulk generator can skip them.

| Concern | File |
|---|---|
| Matching, blocks, generation | `lib/hours/shifts.js` |
| Holiday feed + parsing | `lib/hours/holidays.js` |
| Monthly totals (pure, tested) | `lib/hours/payroll.js` |
| Roster server actions | `lib/actions/shifts.js` |
| Admin roster + missed queue | `components/admin/ShiftsAdmin.js` |

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

Node's built-in runner, no dependencies added, files in `test/*.test.mjs`. 121 tests: `rates.js` (tiers, the flat OT rate, tier-from-position matching order, SG time boundaries, duration and rounding, money formatting), `geo.js` (fix validation, null-island and accuracy-ceiling rejection, display helpers), `shifts.js` (matching, back-to-back blocks, roster generation, midnight-spanning, holiday pay), `holidays.js` (feed parsing), and `payroll.js` (monthly totals and the snapshot rules).

`test/payroll.test.mjs` also runs against a **real database** built by `ensureSchema` in a temp directory, because the double-pay guard is a partial unique index — testing a hand-written copy of it would prove nothing. It pins: one shift can never be paid twice, a worked shift can't be deleted, cancelling frees the slot, and deleting an account still works despite the FK.

Three things to know:

- **Run it under `TZ=UTC` as well as locally.** Production sets no `TZ` so the container runs UTC, while a dev laptop runs UTC+8. Several date rules would pass in one and fail in the other. `lib/date.js` is server-local and genuinely wrong in production — never use it for anything payroll-shaped.

- **The live Nominatim round-trip is opt-in**, so the default run is offline and deterministic: `LQK_TEST_NETWORK=1 npm test`.
- Tests are `.mjs` deliberately. The repo has no `"type": "module"`, and setting one to tidy the `MODULE_TYPELESS_PACKAGE_JSON` warning would change module resolution for every plain `.js` file in the project — not worth it for a cosmetic warning.

The tests assert *rules*, not current output, and each says which rule it protects. If one goes red, the fix is almost never to update the expectation.

**Verified locally for rostered shifts (2026-08-10)**: one tap creating two sessions for a back-to-back block, each carrying the rostered window and the real arrival time; the payable guard keeping an in-progress shift out of the CSV, the queue and the totals; a public holiday paying $80 where an identical ordinary shift paid $40, with the multiplier snapshotted at approval; the bulk generator creating 3 shifts and skipping Deepavali; the full missed-clock-in loop (teacher explains → admin pays it → session created); and bulk approve taking only the clean rostered shift while leaving the holiday and missed-accepted ones for a human.

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

**The build emits warnings** about unexpected files in the NFT trace, pointing at `next.config.mjs`. Pre-existing, caused by the dynamic imports in the dzikir loaders. It is now reported twice rather than once simply because another module reaches the same graph — same issue, not a new one. Don't chase it.

---

## 8. The rest of the portal, briefly

Beyond work hours, the portal routes are `dashboard`, `hafalan` (Quran tracker, Google-Sheet backed), `quran` (reader), `reading`, `review`, `dzikir` (Wirid & Doa / Maulid), `solat` (prayer times + azan with web push), `qibla`, `notebook` (AI-assisted Halaqah notebook), `ilmu`, `kalimah`, `packs` (lesson packs), `achievements`, `profile`, and `admin` (accounts, staff roster, invites).

It is installable as a PWA (service worker, manifest, install prompt). Deliberately, the service worker caches static assets only and **never authed data**. There is no native app-store presence; that would need a Capacitor/TWA wrapper and Karim supplying the paid developer accounts.

Auth is self-registration against an invited-emails allowlist, with the HQ code (`LQK_HQ_CODE`) as the only route to an admin role.

---

## 8a. Look and feel — cream & naturals (Aug 2026)

Three rules, all of them things a previous pass got wrong:

**1. The palette lives in one file.** `app/globals.css` holds every colour as a CSS variable. Cream page `#FBF6EC`, white cards floating on it, warm-bark ink `#3B372B`, harvest-amber accent `#96681A`, and three natural surface tones spread evenly across the pages — sage `#DDE5D3`, clay `#F3D9C8`, honey `#F8E3BE`. The token *names* are historical (`gold-soft` is the sage, `sage-soft` the clay, `sand` the honey) and are referenced in hundreds of places: **change the values, never the names.** There is no violet, lavender or pink anywhere; that direction was retired.

**2. Art is coloured by the real world, not by the theme.** Every illustration is a clay render of a real object in its real materials — brass compass, walnut-and-brass trophy, steel microphone, cream paper, leather books. Nothing is tinted to match the palette, because a palette-tinted icon set has to be redrawn every time the palette moves. Two subjects are absolutely fixed: **the Kaaba is black kiswah with its gold band, and the Green Dome of Masjid an-Nabawi is green** — never restyled, at any size, for any reason. The prompts and these rules live in `scripts/art/manifest.mjs`.

**3. Every generated image ships with a real alpha channel.** The Gemini image models cannot emit one (ask for a transparent background and you get a *painted checkerboard*), so art is generated on flat white and keyed out by `scripts/art/matte.mjs` — border flood-fill, feathered mask, un-premultiplied against white so there is no pale halo on dark surfaces. This replaced a `mix-blend-mode: multiply` hack that only worked on near-white backgrounds. Don't reintroduce a blend mode; if a new image looks like it has a plate, it wasn't keyed.

Regenerating art (costs money, overwrites checked-in files, run on a clean tree and eyeball the diff):

```bash
GEMINI_API_KEY=... node scripts/generate-art.mjs          # all, or pass spot / spot/qibla
GEMINI_API_KEY=... node scripts/restyle-art.mjs           # the LQK character art, edited in place
```

`restyle-art.mjs` is image-to-image on purpose: the ustazah and the two children are a consistent cast across the whole brand, and a fresh text-to-image render comes back with different faces. It reads what is on disk, so running it twice compounds.

**The logo.** `brand/lqk-logo.svg` — the LQK monogram in brand orange `#F0A41F` — is the single source for the favicon, the PWA icons, the Apple touch icon (`node scripts/generate-icons.mjs`) and the inline `components/LqkMark.js`. Nothing else may stand in for it, and it is never re-tinted to match a theme: the palette follows the logo, not the other way round. (`scripts/app-icon-source.png`, the old terracotta "LQK Teachers Portal" illustration, is no longer referenced by anything.)

---

## 9. First hour

```bash
git clone git@github.com:LQ-Media/LQK-Teachers.git && cd LQK-Teachers
npm ci && cp .env.example .env.local   # then set SESSION_SECRET
npm run dev
```

Register an account, or seed a fresh DB and use the demo logins. Open `/hours`, switch the session type to **Ad-hoc / OT**, and you'll see the "Where are you? — Tag my location" control. On `localhost` it is a secure context, so capture works and you can watch the whole path: tap, see the resolved address, clock in, then look at Admin → Work hours and export the CSV.

Then read, in this order: `lib/hours/rates.js` (the money), `lib/actions/hours.js` (the writes), `lib/db.js` → `ensureSchema` (the shape).
