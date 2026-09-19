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
- Optional: `RESEND_API_KEY` if you're touching password reset or event email, and the OAuth credentials (`GOOGLE_*`, `MICROSOFT_*`, `APPLE_*`) if you're touching social sign-in. Each is independent — see §4b and `.env.example`.

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

**Public holidays** come from MOM's official dataset on data.gov.sg, imported by `scripts/sync-public-holidays.mjs` (re-runnable, dry-run by default). Run it when MOM publishes a new year. Shifts on those dates are stamped and pay the multiplier; the New shift form can skip them.

### 4b. One form for every shift (2026-09-17)

Karim: *"remove the generate roster button / the add shift button change to as attached, it will be for teaching and OT shift making, all fields the same"*, with Sling's **New shift** panel as the spec.

So **Add shift** is now the only way an admin creates anything, and `components/admin/NewShiftModal.js` is Sling's panel: DATE, TIME, REPEAT, LOCATION, POSITION, EMPLOYEE(s), NOTES, PUBLISH. **Generate roster** and both actions behind it (`createShift`, `generateShifts`) are gone.

**Why the generator had to go rather than sit alongside it.** It was a second recurrence engine. Two engines is how the grid and the generator end up disagreeing about what a fortnight contains, and the one that is wrong is the one nobody is looking at. There is now exactly one: `expandDates` in `lib/hours/shifts.js`, reached through `createShifts`.

**POSITION decides teaching vs OT.** `lib/hours/positions.js` is the single list, shared by the form and the action so neither can drift. Picking *Events Team* makes an OT shift with `ot_role='events'`; picking *Lead Teacher* makes a teaching one. `positionMeaning()` returns **null** for anything off the list and the action refuses — it never falls back to teaching, because that fallback would be a guess about money.

**"Every N weeks" counts CALENDAR weeks** from the Monday of the start date's week, not seven-day blocks from the start date. Starting on a Wednesday with *Mon + Wed, every 2 weeks*, blocks would put that Wednesday and the following Monday in one fortnight and then skip a Monday — a pattern nobody chose. Covered by `test/positions.test.mjs`.

**PUBLISH is real, and that is the part to be careful with.** `shifts.published` (INTEGER NOT NULL DEFAULT 1 — the default is what keeps every existing shift visible through the migration). A draft is invisible to the teacher AND unpayable. **Four readers filter `published = 1`, and a fifth thing depends on it:**

| Reader | File |
|---|---|
| The teacher's roster and their relief offers | `app/(portal)/hours/page.js` |
| Clock-in (`clockIn`) | `lib/actions/hours.js` |
| Reminders and no-clock-in chases | `lib/hours/notify-scheduler.js` |
| The relief board (`availableShifts`), offering, and the claim UPDATE | `lib/actions/relief.js` |

Add a new teacher-facing reader and you must filter it too, or the toggle starts lying. A draft still **occupies the slot** for clash checks — deliberately, because rostering somebody else over it would mean publishing produced a clash nobody was shown.

Publishing is `setShiftPublished` in `lib/actions/shifts.js`, on the **Publish / Unpublish** button in the shift-details footer. Without it the toggle would be a trap door: you could save a draft and nothing in the portal could ever publish it. Unpublishing is refused once anybody has clocked in.

**`shifts.position` vs `profiles.position`.** Both exist and they mean different things — the shift's own position is what it was WORKED in (a lead teacher covering an assistant's class), the profile's is the person's job title from the imported Sheet. The old `SELECT` aliased `p.position AS position`, which silently beat `s.*`; it is now `AS teacher_position`, and `roleOf()` reads the shift first and the profile as a fallback. Anything new that colours or labels by position must do the same.

| Concern | File |
|---|---|
| Matching, blocks, generation | `lib/hours/shifts.js` |
| Holiday feed + parsing | `lib/hours/holidays.js` |
| Monthly totals (pure, tested) | `lib/hours/payroll.js` |
| Roster server actions | `lib/actions/shifts.js` |
| Admin roster + missed queue | `components/admin/ShiftsAdmin.js` |

### 4c. The fence has a screen (2026-09-17)

Karim asked for the coordinate sync to be a button rather than a terminal command, because there is no terminal on the Railway box. **Admin → Access → Clock-in location** (`components/admin/GeofencePanel.js`, `lib/actions/geofence.js`) now does everything `scripts/sync-location-coords.mjs` did, and the script stays for deploys. Both write the same two things — `location_coords` and the `geofence_enabled` key — through the same guard in `setGeofenceEnabled()`, so they cannot disagree.

**The screen is ordered against the switch on purpose.** Reading down: what the fence is doing now → whether every centre has a coordinate, and the button → what real taps have recorded → the switch → who threw it last. The switch is at the BOTTOM because with the fence on a failed check refuses the clock-in, and no clock-in means no pay. Turning it on takes a confirm step that states the count of recorded taps that would have been refused. Turning it OFF is one click, never guarded, never confirmed: that is the button somebody needs while a teacher is standing at the centre unable to start.

**The evidence table is the point of the whole feature shipping off.** `lib/hours/fence-report.js` is pure and turns the recorded verdicts into one answer — how many real taps would have been turned away, and who. Three rules in it are not obvious and are pinned by `test/fence-report.test.mjs`:

- **`no_fix` is never counted as a block**, because `geofenceRefusal()` never refuses it. Counting it would overstate the risk and talk somebody out of a switch that is fine.
- **Unfenced taps (HQ, Outside LQK, Online) are excluded from the denominator.** A month of online meetings would otherwise dilute the percentage and make a real problem at a centre look small.
- **A session with no recorded verdict is dropped, not assumed good.** Sessions from before the fence existed have `geo_fence` NULL; bucketing one as "inside" would make the report lie in the reassuring direction.

The table also reports the **furthest ACCEPTED distance per centre**, separately from the worst refused one. That is the number that says whether a kilometre is comfortable: accepted taps landing at 940 m mean the fence is one bad fix away from refusing somebody who is at work.

**`geofence_log`** records who threw the switch and which way, with the name denormalised so it outlives the account. A separate table rather than a row in `admin_scope_log`, whose `subject_id` is NOT NULL and cascades from `profiles` — a fence switch would have had to borrow a person as its subject and would then read, on the Access history screen, as if that person's access had changed. Only the screen writes it; a script run has no session to attribute.

**`geocodePostalCode()` now says WHICH failure it was**, and that matters more than it looks: it used to collapse "couldn't reach OneMap" and "no exact match for that postal code" into the same null, so a network blip told an admin their correct postal code was wrong and sent them off to change it. When every centre fails unreachably, the screen says so once rather than six times.

### 4d. Admin is two areas now, not seven tabs (2026-09-17)

Karim: *"i find the admin view very messy. i want the Sling functions to be on its own with the other admin matters for this login accounts and invited emails on its own tab"*, and *"the menu at the top can be as attached from the sling"*.

`/admin` now has **two areas**:

| Area | Holds |
|---|---|
| **Admin** | Login accounts · Invited emails · Access (who has access / apply the standing list / history) |
| **Shift Roster** | Sling's tile menu → Schedule · Employees · Positions · Locations · Work hours · Labour cost · Settings |

`components/admin/AdminApp.js` is the shell; `components/admin/ShiftRoster.js` owns the tiles; `components/admin/SlingNav.js` is the tile row.

**Only tiles that open something real.** Sling's row also has Groups, Tags and Announcements; LQK has nothing behind those, and Karim chose explicitly to leave them out — a tile that opens an empty page makes somebody wonder what they have failed to set up.

**Three things moved, each for a reason.** `Sync holidays` left the roster toolbar (a once-a-year action sat next to one used twenty times a week) and the clock-in location check left Access (a rostering setting filed under permissions) — both are under Shift Roster → Settings now, as they are in Sling. `Payroll report` became the `Labour cost` tile, Sling's name for it.

**The three reference screens are read-only on purpose**, and each says where the editable version is so a read-only table never reads as a broken one. Employees is the accounts list shown the way the roster needs it — editing belongs on the Admin tab, because two places to edit a person is two answers to what their position is. Positions and Locations are code, because the first decides whether a shift pays as teaching and the second is what the geofence is built from.

**Positions renders its colour swatch by asking `roleOf()`** rather than repeating the rule, so the calendar legend and that table cannot drift.

**What a centre IT Head sees:** no area switch at all, and four tiles — Schedule, Employees, Positions, Locations. Work hours and Labour cost are pay; Settings can stop every teacher in the company clocking in. All three are guarded in `ShiftRoster` as well as absent from the tile list, because a missing tile stops a click and not a `section` value arriving another way.

**The page is full width.** It was capped at `max-w-5xl`, which squeezed a calendar of 71 teachers into half a monitor.

**Staff roster tab removed**, as asked. The `students` rows it edited are untouched and still drive the Tracker, the dashboard and achievements, and `attachToRoster()` still creates or links one whenever a login account is created. What is gone is the only screen that edited a row's **class and juz** by hand — nothing else in the codebase writes `students.juz`, so it now stays at its imported value, or at 1 for a new account. Say so if that needs a home.

### 4e. Who has signed up, and editable positions (2026-09-17)

**Sign-up status.** `profiles.last_login_at` is new, stamped by `login()` and `register()`. Login accounts now shows **three** states, and the third is why `lib/admin/signup.js` is a module rather than a ternary:

| State | Means | Reminder? |
|---|---|---|
| `active` | signed in, holds a password they chose | no |
| `never` | an admin made the account, nobody has used it | yes |
| `reset` | signed in before, an admin has since reset them, new password not picked up | yes |

Collapsing `reset` into `never` would report somebody as never having signed up when in fact an admin broke it; collapsing it into `active` would hide a teacher who is locked out right now.

`last_login_at` is backfilled to **NULL**, not to a date. An older account holding its own password therefore reads as signed up with "Before 17 Sep" where a date would go — the opposite default would have declared all 71 accounts unsigned on the day this shipped and emailed every one of them a new password.

**Sending a reminder RESETS that person's password**, and Karim chose that over building an activation-link flow because the portal still has no forgotten-password page. Three rules in `lib/actions/signup.js` are deliberate:

- **The reset is written BEFORE the email is sent**, per person. A failed email then leaves somebody holding a password they were never told — recoverable, and the screen surfaces it. The other order would send a password that is not yet the account's, and a failed write after it would leave a credential that does not work and no way to know why.
- **25 a press, enforced.** Resend's free tier is 100 a *day* shared with the Parents portal (see the warning atop `lib/events/mail.js`). The remainder comes back as ids, not a count, so the next press knows who it still owes. Duplicates are collapsed — two resets in one batch means the first email's password is dead before it arrives.
- **The state is re-derived server-side**, never trusted from the browser. A stale screen could name somebody who signed in five minutes ago.

Failures are logged to `signup_reminders` with the reason and do **not** count towards "Reminded 3×", or the number would describe emails nobody received.

### 4f. Positions are editable (2026-09-17)

Karim: *"i need the positions page or it to be edittable for me if i need to edit or add."*

**A correction to §4b:** it said the position list had to stay in code "because it decides pay". That was overstated. `rateFor(category, payTier, otRole)` reads the **tier on the person** for teaching and the **OT team's rate** for non-teaching — a position decides teaching-vs-OT and which team, and nothing about a rate. Editable is safe.

`shift_positions` is the live list, **seeded once** from `SHIFT_POSITIONS` so a deploy changes nothing. The seed is guarded on the table being EMPTY, not per row: `INSERT OR REPLACE` on every boot would silently undo a rename or an archive on the next deploy. `lib/hours/positions.js` stays as the seed and as the floor for an empty table — a Position dropdown with nothing in it cannot create a shift.

**`name` is the primary key and IS the value stored in `shifts.position`**, so a rename rewrites those rows in the same transaction. The form shows the count before you save. A surrogate id was the alternative and would have meant migrating every deployed shift's position string.

Three rules worth keeping:

- **Re-classifying a position does not re-price shifts already created.** A shift's `category` is stamped at creation and is what the payroll report reads; flipping a position to OT afterwards must not retroactively unpay a month of approved teaching.
- **Archive, never delete.** A position is the classification on months of paid shifts. `positionMeaningLive()` therefore resolves *archived* positions too, so tidying the list never locks the edit form out of old shifts. Archiving the last live position is refused.
- **No base wage.** Sling has one; LQK does not pay that way, and two sources of truth for pay is how they end up disagreeing. Karim chose to leave it out.

A chosen colour beats the name-derived one in `roleOf()`, and `cancelled` is not offered as a choice — it is the status colour, and painting a live position grey would make a working shift look called off.

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

## 4b. Signing in — social sign-in & password reset (shipped 2026-09-07)

Before this, the only way in was an email and a password, and the only way to
recover a forgotten one was to ask an admin. Now there are three doors, and
they all lead to the same account.

### Password reset

"Forgot password?" on the login page emails a one-time link (`/reset-password`),
good for an hour. Redeeming it sets the password and signs them straight in.

- Only the **SHA-256 of the token** is stored (`password_resets`). The token
  itself exists only in the email that was sent, so a leaked DB backup yields
  nothing usable.
- The form's answer is **identical whether or not the address has an account**,
  whether or not the rate limit was hit, and whether or not the send succeeded.
  That is deliberate — otherwise the form becomes a way to ask the portal "does
  this person work at LQK?" against 77 real addresses. Don't "improve" the copy
  by making it more specific.
- **Three requests per address per hour.** Asking again burns the earlier link,
  so the newest email is always the one that works.
- Needs `RESEND_API_KEY`. Without it the page says so plainly and tells them to
  ask an admin, rather than pretending to send.

### Social sign-in (Google, Apple, Microsoft)

**Hand-rolled OpenID Connect, not NextAuth/Auth.js.** The portal already has its
own session (`lib/session.js`) carrying role, branch and the must-change gate,
and every page reads it through `lib/dal.js`. A second session system would mean
two sources of truth for "who is this and what may they do" on a portal that
pays people. `jose` was already a dependency and does the hard part. **No new
npm packages were added.**

**These are deliberate decisions. Check with Karim before changing them:**

- **Sign-in never creates an account.** It finds an existing profile or refuses
  with "ask your admin". A profile carries a role, a branch and a pay tier —
  letting a Google sign-in mint one would put a stranger inside payroll.
  Registration and invites are untouched.
- **A password always keeps working.** Connecting Google is an extra door, never
  a replacement, so a Google outage or a lost work account never locks a teacher
  out. Disconnecting is therefore always safe.
- **A provider account may only belong to one profile** (`UNIQUE(provider,
  subject)`). Without that, two teachers sharing one Google account could each
  sign in as the other.
- **Matching is on the provider's `sub`, not the email.** The email is used only
  on the very first sign-in, to find the profile, and only when the provider has
  **verified** it. See `trustedEmailFromClaims` in `lib/auth/providers.js` — this
  is the security boundary of the whole feature, and it is what stops anyone who
  can put `karim@littlequrankids.sg` on an account they own from signing in as
  Karim. It is covered by `test/auth-providers.test.mjs`.
- **Apple "Hide My Email" relay addresses match nothing**, by design — they
  aren't anybody's work email. Those teachers sign in with their password once
  and connect Apple under **Profile → Connected accounts**, which proves the two
  accounts are the same person. Same route for a personal Gmail that isn't the
  work address.
- **Microsoft on the default `common` tenant trusts no email at all** (the
  "nOAuth" pattern: the id_token can be signed by a directory the attacker
  created). Set `MICROSOFT_TENANT` to the LQK directory to make Microsoft email
  matching work; without it Microsoft is link-only.

**A provider is off unless its variables are set** — no button, no half-working
flow. That is what lets Google ship now and Apple follow whenever the paid
developer account exists: environment variables only, no code change. Every
variable, and where to get it, is documented in `.env.example`.

Redirect URI to register with each provider, matched literally:
`<LQK_PUBLIC_BASE_URL>/api/auth/<provider>/callback`

| Concern | File |
|---|---|
| Provider registry + email-trust rules (pure, tested) | `lib/auth/providers.js` |
| The OIDC flow: PKCE, state, id_token verification | `lib/auth/oauth.js` |
| `oauth_identities` reads/writes | `lib/auth/identities.js` |
| Reset tokens (pure-ish, tested) | `lib/auth/reset.js` |
| Start / callback routes | `app/api/auth/[provider]/` |
| Reset + disconnect actions | `lib/actions/auth.js` |
| Resend transport, shared with events | `lib/mail.js` |

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

**Verified in a browser for sign-up status and editable positions (2026-09-17)**, against a seeded database holding all three states: the tab reading "· 4 not signed up", the filter pills `Everyone (7) / Not signed up (4) / Signed up (3)` narrowing to exactly the 4 outstanding rows, "Before 17 Sep" on the undated active account, "Reminded 2× · last 14 Sept 2026" on the chased one, and the Remind button disabled with a plain reason while `RESEND_API_KEY` was unset. Then with a key set: a send reported **"0 sent, 1 failed — Resend returned 403. Their password is now lqk-rkc8yy — pass it on by hand"**, and the database confirmed the hash HAD changed, the row was logged `ok=0` with the reason, and the failure did not count towards "Reminded N×". Positions: adding "Relief Teacher" with a palette colour and seeing it in the Add-shift dropdown on the same visit; the rename warning naming the shift count before saving; the OT-team dropdown appearing only for an OT position; no wage column anywhere. **Not verified here:** a SUCCESSFUL send — this sandbox's egress policy blocks Resend, so only the failure path could run.

**Verified in a browser for the two-area Admin (2026-09-17)**: the Admin/Shift Roster switch with Staff roster gone; the Admin side showing only Login accounts, Invited emails and Access; content measuring 1376px of a 1600px viewport rather than a capped column; the seven tiles reading `SCHEDULE·18 | 14 EMPLOYEES | 11 POSITIONS | 7 LOCATIONS | WORK HOURS | LABOUR COST | SETTINGS` with no Groups/Tags/Announcements; every tile opening its screen; Employees narrowing to "2 of 14" on the query *lead tampines*; Locations splitting 4 fenced from 3 unfenced and naming the fence's current state; Settings listing 2026 and 2027 holidays above the fence panel; `Sync holidays` gone from the roster toolbar with `Add shift` still on it; and a centre IT Head seeing no switch, four tiles, and landing on the calendar. One real bug was caught doing this: a `opacity-0` placeholder "0" on the count-less tiles was invisible to the eye but not to `innerText`, so the tile read "0 SCHEDULE" to a screen reader.

**Verified in a browser for the fence screen (2026-09-17)**, against a seeded database holding 36 recorded verdicts: with no coordinates, six centres reading "Not resolved", the switch withheld entirely and the reason naming all six; after resolving, `3 of 34 recorded clock-ins (9%) would have been refused`, Tampines Junction showing 8 taps with 1 refused up to 1.2 km, and Woods Square showing a furthest-accepted of 940 m; the confirm step restating the count; the chip flipping to ON, the switch history recording "Turned ON by Nur Abdul Karim", and the off button appearing in its place; then OFF again with both entries in the history. A centre IT Head sees no Access tab at all. OneMap itself is blocked by this sandbox's egress policy, so the network half was exercised only on its failure path — which turned out to be worth doing: it showed the screen reporting `OneMap answered HTTP 403` per centre plus one consolidated banner, and it caught `load()` wiping the error message it had just set.

**Verified in a browser for the New shift form (2026-09-17)**, against a seeded scratch DB: **Generate roster** gone and **Add shift** the only button; the REPEAT menu matching Sling item for item; the day toggles and the end date appearing only once something repeats, and *This week* naming its own Sunday instead of asking; *Mon + Wed, every 2 weeks* for three teachers writing 21 shifts on 2/4, 16/18, 30 Nov, 2 and 14 Dec; a second attempt reporting **"1 shift added for 1 person. NURAISHAH … already has a shift on 2026-11-02"** rather than silently dropping one; a draft hidden from the teacher's `/hours`, then visible the moment it was published, with both steps in the shift history; and a shift created as *Intern* colouring as an intern even though the teacher's profile says assistant teacher.

**Verified locally for rostered shifts (2026-08-10)**: one tap creating two sessions for a back-to-back block, each carrying the rostered window and the real arrival time; the payable guard keeping an in-progress shift out of the CSV, the queue and the totals; a public holiday paying $80 where an identical ordinary shift paid $40, with the multiplier snapshotted at approval; the roster generator of the day creating 3 shifts and skipping Deepavali; the full missed-clock-in loop (teacher explains → admin pays it → session created); and bulk approve taking only the clean rostered shift while leaving the holiday and missed-accepted ones for a human.

**Verified in production**: deploy succeeded, container healthy, `/login` 200, `/hours` redirects to login, the CSV route returns 401 rather than 500 for an unauthenticated caller.

**Not verified in production**: the actual capture flow. That needs a real login, which the previous session declined to do with staff credentials. **This is the top item for whoever picks this up.**

To close it: log in on a phone, start an Ad-hoc / OT session, tap "Tag my location", confirm the resolved address looks right, then check it appears in Admin → Work hours and in the month's CSV.

One thing to watch for specifically: **geolocation requires a secure context.** Over HTTPS on the live domain it is fine. If anyone tests by pointing a phone at a laptop's LAN address over plain `http://`, the browser silently never resolves the request — `LocationTag` detects this and shows an explanatory message rather than spinning, but it's still the most likely "it's broken" report you'll get.

---

## 6. Open items

1. **Production spot-check of the capture flow** (above) — highest priority.
2. **Nominatim load.** Fine today: tagging is rare and human-paced, requests are throttled to 1/sec and cached. If OT tagging becomes routine across all ~77 staff, revisit — the usage policy is aimed at exactly this kind of app, and a self-hosted or commercial geocoder is the escape hatch.
3. ~~**No geofencing or validation.**~~ **Superseded, Sep 2026.** Karim asked for the Sling geofence, and it is built (`lib/hours/locations.js`, `lib/hours/geocode.js`). Two live policy decisions in it are his to revisit, and both were judgement calls rather than instructions:

   - **The fence ships SWITCHED OFF** and every clock-in records its verdict and distance regardless. Turn it on at **Admin → Access → Clock-in location** (or `node scripts/sync-location-coords.mjs --enable`); both refuse while any centre is unresolved. The reason it is not on by default: combined with "no clock-in means no pay", a deploy where geocoding had not run would refuse every clock-in at every centre on the first morning. See §4c.
   - **A phone that cannot get a fix is ALLOWED through**, recorded as `no_fix`. Every centre is on an upper floor of an office block, which is where GPS is worst, and docking a teacher's pay for their building's concrete seemed the wrong failure direction. Sling blocks this case. If Karim wants it blocked, it is one branch in `geofenceRefusal()` in `lib/actions/hours.js`.
4. **`claude-test@lqk.test`** is a leftover admin account in the local dev DB with a known password. Harmless locally; delete it if you prefer. Confirm it does **not** exist in production.
5. **A password reset does not sign other devices out.** Sessions are stateless
   signed JWTs valid for 30 days, so nothing can revoke them — the same has
   always been true of the existing "change password" screen, and this feature
   doesn't make it worse. Fixing it properly means stamping the profile with a
   password epoch and checking it in `requireSession` (`lib/dal.js`), which adds
   a DB read to every request in the portal. Worth doing; deliberately not
   bundled into the sign-in work. Raise it with Karim.
6. **Apple and Microsoft are built but dormant** until their credentials exist —
   Apple needs the paid developer account. The code paths are unexercised
   against the live providers, so treat the first real sign-in with each as a
   test. Google is the one to verify first.
7. **Test coverage, partly addressed.** The suite covers the attendance rules, payroll periods, the admin-scope boundary, the geofence, the notification windows, the relief race and the sign-in helpers (`lib/auth/providers.js`, `lib/auth/reset.js`, `lib/auth/identities.js`) — several against a real database built by the real migration. The server actions in `lib/actions/hours.js` are still not covered directly; the note below stands for those.

   **The original note:** Test coverage stops at the pure helpers. `npm test` covers `lib/hours/rates.js` and `lib/hours/geo.js`. It does **not** cover the server actions in `lib/actions/hours.js` — including the monthly totals in `hoursAdminData`, where approved sessions use their snapshotted `rate_cents` and pending ones use the teacher's current tier. That branch is the most valuable thing still untested, but covering it means either a DB fixture harness or extracting the aggregation into a pure function. The extraction is the tidier option and it touches payroll code, so agree it with Karim first.

---

## 7. Gotchas that will bite you

**There is CI now** (`.github/workflows/ci.yml`, added Sep 2026) — before that the repo had none and every PR showed zero checks. It runs `npm test` under **both** `TZ=UTC` and `TZ=Asia/Singapore`, because payroll is reckoned in Singapore time while the server runs in UTC and that is where this codebase's date bugs live. Lint is advisory until the three pre-existing `set-state-in-effect` errors are fixed; the workflow says which line to delete to make it a real gate. Note that `continue-on-error` is deliberately NOT used — it still posts a red X on the PR.

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
