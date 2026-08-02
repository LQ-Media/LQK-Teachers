# Achievements — build spec

Decisions locked with Karim, 2026-08-02.

**Status: BUILT** (2026-08-02) — all ten sections below are implemented and
verified locally against a seeded database. Not committed, not deployed. The
sidebar item no longer says "Soon".

Deploy steps, in order:

1. Push → the additive migration runs on boot (new tables + `students.profile_id`).
2. `node scripts/link-roster-accounts.mjs --dry-run` to review, then re-run
   without the flag to apply. On the current dev data this matched **68 of 68**
   roster rows with nothing ambiguous.
3. Anything left over: Achievements → Manage → Account links.

## 1. What the page is

Three things at once, in three tabs, plus an admin tab:

| Tab | Who sees it | Content |
|---|---|---|
| **Me** | everyone | Star level + progress bar, current reading streak, badge wall (earned + locked), my certificates, my honours, my point breakdown |
| **Branch** | everyone | My branch's Top 5 podium, branch total vs the other branches, badges earned in my branch this month |
| **Everyone** | everyone | Org-wide Top 5 podium (this month) + all-time hall of fame, monthly title holder, recent honours & nominations |
| **Manage** | admin only | Full ranked table, award honours, review nominations, approve/reject certificates, maintain cert types, link roster rows to accounts |

Nobody is ever listed *below* a colleague — only Top 5 podiums are public. Each
teacher sees their own standing privately ("you're in the top 30%").

## 2. Point system

Weights live in one config file, `lib/achievements/points.js`, in the style of
`PAY_TIERS` in `lib/hours/rates.js` — edit the numbers, scores recompute, no
migration.

```
READING (habit)
  Read ≥30s in the reader ........ +5 / day
  Each consecutive 10 min ........ +2   (max +10/day → 50 min counted)
  7-day streak ................... +25
  30-day streak .................. +100
  100-day streak ................. +300

HAFALAN (their own lessons)
  Lesson graded Excellent ........ +10
  Lesson graded Pass ............. +5
  Lesson graded Repeat ........... +2
  Surah completed ................ +50
  Juz completed .................. +200

TEACHING (lessons they log for staff)
  Each lesson logged ............. +3

RECOGNITION
  Approved certificate ........... +100
  Monthly title .................. +250
  One-off award .................. +50
```

**Work hours contribute nothing.** Deliberate: hours are pay-adjacent, so they
stay on `/hours` and the admin view only, and the score can never be read
backwards to infer someone's shifts or earnings.

### Seasons

Monthly season **and** all-time, side by side. The season resets on the 1st
(Singapore time) so it's always winnable; badges, certificates and honours are
permanent. Past months stay viewable.

### Levels

Star levels 1–10 with a progress bar to the next, driven by the **all-time**
score:

| Level | Points | Level | Points |
|---|---|---|---|
| ★1 | 0 | ★6 | 2,000 |
| ★2 | 100 | ★7 | 3,500 |
| ★3 | 250 | ★8 | 5,500 |
| ★4 | 500 | ★9 | 8,000 |
| ★5 | 1,000 | ★10 | 12,000 |

### Who competes

Everyone with an account (all 76, HQ and management included). MANAGEMENT TEAM
is already a tracker class, so it stands as a fifth "branch" in the
branch-vs-branch view.

## 3. Reading streaks — new tracking required

**The app currently cannot tell that anyone read the Quran.** A
`reading_entries` row only appears on a manual log at `/reading` or on a
bookmark with the opt-in toggle on (`lib/actions/reading.js:63`).
`quran_bookmarks` is a single overwritten row with no day history.

So: passive tracking, new table.

```sql
CREATE TABLE reader_activity (
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  date TEXT NOT NULL,              -- YYYY-MM-DD, Singapore
  seconds INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (teacher_id, date)
);
```

- The Quran reader posts a heartbeat every 30s while the tab is **visible**.
  Hidden tab or idle → no ping, so leaving it open overnight earns nothing.
- A day counts toward the streak at **≥30 seconds** — the safeguard against
  log-in/log-out streak farming.
- Bonus tiers: +2 per completed 10 minutes, capped at +10/day.
- Streak = consecutive SG dates present in the table. Computed on read, so no
  nightly job.
- One row per teacher per day: tiny table, ~76 rows/day.

## 4. Identity: linking accounts to the roster

**Blocker found.** `students` (the monitored roster) has no link to `profiles`
(login accounts), and `lessons.teacher_id` is *who logged it*, never *whose
hafalan it was*. Without a link the entire HAFALAN block above is unattributable.

Fix:

1. Add `students.profile_id TEXT REFERENCES profiles(id)` (additive migration).
2. One-off script matches by full name — both tables were imported from the same
   Sheet, so most will match exactly.
3. Admin screen gets a "Linked account" dropdown per roster row to fix the
   remainder and handle new staff.
4. Unlinked rows simply earn no hafalan points; nothing breaks.

## 5. Milestone detection

- **Surah completed** — union the `from_ayah`–`to_ayah` ranges across that
  student's lessons; complete when every ayah of the surah is covered. Counts
  coverage regardless of grade.
- **Juz completed** — fires off the admin-maintained `students.juz` column, not
  computed. Juz boundaries fall mid-surah and would be fragile to derive; the
  juz number is already part of how the roster is managed.

## 6. Certificates

Teacher uploads, admin approves. Reuses two patterns already in the codebase:
the session-gated image upload from `/profile` avatars (`lib/avatar.js`) and the
`pending → approved/rejected + reviewer_id + reviewer_note` shape from
`work_sessions`.

```sql
CREATE TABLE cert_types (            -- admin-maintained, keeps data comparable
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,                -- "ARS Certification", "Tajweed Level 1"
  description TEXT,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE certifications (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  cert_type_id TEXT REFERENCES cert_types(id),
  issuer TEXT,
  issued_on TEXT,
  image_path TEXT NOT NULL,          -- ${LQK_DATA_DIR}/uploads/certs/<uuid>.<ext>
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','approved','rejected')),
  reviewer_id TEXT REFERENCES profiles(id),
  reviewer_note TEXT,
  reviewed_at TEXT,
  created_at TEXT NOT NULL
);
```

Approved certs show a "Verified" tick with the type, issuer and date, image
viewable through a session-gated route (`app/api/cert/[id]/route.js`, mirroring
the avatar route). No expiry tracking, and approval does **not** touch pay tier —
both explicitly out of scope for v1.

> Note for later: ARS certification and the `lead_ars` pay tier ($25/hr in
> `lib/hours/rates.js`) are the same fact recorded in two places. Worth wiring
> up once this ships, so they can't drift.

## 7. Honours & nominations

All three mechanisms:

```sql
CREATE TABLE honours (
  id TEXT PRIMARY KEY,
  teacher_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('monthly','oneoff')),
  title TEXT NOT NULL,               -- "Teacher of the Month" | free text
  reason TEXT,
  month TEXT,                        -- YYYY-MM, for kind='monthly'
  awarded_by TEXT REFERENCES profiles(id),
  created_at TEXT NOT NULL
);

CREATE TABLE nominations (
  id TEXT PRIMARY KEY,
  nominee_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  nominator_id TEXT NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  reason TEXT NOT NULL,
  month TEXT NOT NULL,               -- YYYY-MM, one nomination per person/month
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending','confirmed','declined')),
  created_at TEXT NOT NULL
);
```

- **Monthly title** — admin picks one holder per month; featured on the Everyone
  tab for that month, then moves to the winner's history.
- **One-off award** — admin writes any title + reason, any time.
- **Nominations** — any teacher nominates a colleague with a reason; admin
  confirms or declines. Nominee sees confirmed nominations; the nominator's name
  is shown (peer praise lands harder when it's signed).

## 8. Badge catalogue

Named badges alongside the star level. Each is earned or locked (locked ones
show the criterion, greyed).

**Reading** — First Steps (first reading day) · Week of Light (7-day streak) ·
Steadfast (30 days) · Unbroken (100 days) · Deep Dive (30 min in one sitting) ·
Fajr Reader (read before 7am, 5 times)

**Hafalan** — Surah Complete (first) · Ten Surahs · Juz Finisher (first juz) ·
Juz Master (5 juz) · Flawless (10 consecutive Excellent)

**Teaching** — First Log · Half Century (50 lessons logged) · Century (100) ·
Reliable Recorder (logged on every day you were clocked in, for a month)

**Recognition** — Certified (first approved cert) · Honoured (first monthly
title) · Peer Favourite (3 confirmed nominations) · **Since the Beginning**
(founding badge, see below)

## 9. Backfill

Imported lesson history feeds **all-time** scores, so the page has real content
on day one. The **monthly season starts everyone at zero** for a fair first race.
Everyone with prior history gets the one-off **"Since the Beginning"** badge.

Reading streaks cannot be backfilled — there is no historical data. Streaks
start from launch day for everyone, which is inherently fair.

## 10. Build order

1. **Foundations** — `students.profile_id` migration + name-match script + admin
   linking UI. Nothing else works without it.
2. **Scoring engine** — `lib/achievements/points.js` (weights),
   `lib/achievements/score.js` (compute from lessons/reading/certs/honours),
   milestone detection. Pure functions, testable without UI.
3. **Reader activity** — `reader_activity` table + heartbeat in the reader +
   streak computation.
4. **Me tab** — level, streak, badge wall, point breakdown. Ships useful alone.
5. **Branch + Everyone tabs** — podiums, branch totals, hall of fame.
6. **Certificates** — upload, cert types, admin approval, gated image route.
7. **Honours + nominations** — admin award UI, nomination flow.
8. Drop `soon: true` from the sidebar item (`components/Sidebar.js:14`).

Steps 1–4 are the meaningful milestone: a working personal achievements page.
5–7 are additive and can ship separately.

## Notes / open items

- `node:sqlite` rows have a null prototype — map to plain objects before passing
  anything to a Client Component, or Next throws.
- All dates are Singapore time; reuse `sgDate`/`sgToday`/`sgMonthNow` from
  `lib/hours/rates.js` rather than rolling new date maths.
- Non-teaching accounts (Founder, Finance Head, Admin Assistant) will score near
  zero since they have no lessons. Chosen knowingly; the Top-5-only display means
  they are never publicly shown at the bottom of a list.
