"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { wordLetters, formatToken, displayName } from "@/lib/qr/passport";
import { parseInviteeCsv } from "@/lib/qr/csv";
import {
  saveQrSetupAction,
  importInviteesAction,
  clearInviteesAction,
} from "./actions";

const TABS = [
  ["setup", "Setup"],
  ["guests", "Guest list"],
  ["hall", "On the day"],
  ["families", "Checked in"],
];

const field =
  "w-full rounded-control border border-line bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-gold";
const label = "mb-1.5 block text-sm font-semibold text-ink";
const card = "mt-6 rounded-card border border-line bg-white p-5 sm:p-6";
const btn =
  "rounded-pill bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60";
const btnQuiet =
  "rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60";

function Notice({ tone = "warn", children }) {
  const tones = {
    warn: "bg-sand text-gold-hover",
    bad: "bg-rust-soft text-rust",
    good: "bg-gold-soft text-ink",
  };
  return <p className={`rounded-control px-3 py-2 text-sm ${tones[tone]}`}>{children}</p>;
}

/* A link a volunteer has to open on their own phone. Copying is the only
   realistic way it gets there, so the copy button is the control and the URL is
   the label — not the other way round. */
function LinkRow({ title, hint, url, icon }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-start gap-3 border-b border-line py-3 last:border-b-0">
      <span className="mt-0.5 flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-control bg-paper-deep text-ink">
        <Icon name={icon} size={17} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-ink">{title}</p>
        <p className="text-xs text-charcoal-soft">{hint}</p>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-1 block truncate text-xs text-gold hover:underline"
        >
          {url}
        </a>
      </div>
      <button
        type="button"
        onClick={() => {
          navigator.clipboard?.writeText(url);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        }}
        className="rounded-pill border border-line px-3 py-1.5 text-xs font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97]"
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </div>
  );
}

export default function QrStudio({ event, stats, families, invitees, baseUrl, doorQr }) {
  const router = useRouter();
  const [tab, setTab] = useState("setup");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState(null);

  const [title, setTitle] = useState(event.title || "");
  const [venueName, setVenueName] = useState(event.venue_name || "");
  const [status, setStatus] = useState(event.status);
  const [intro, setIntro] = useState(event.intro || "");
  const [word, setWord] = useState(event.word || "");
  const [pin, setPin] = useState(event.pin || "");
  const [booths, setBooths] = useState(event.booths.length ? event.booths.map((b) => b.name) : [""]);
  const [tiers, setTiers] = useState(event.tiers.length ? event.tiers : [{ at: 3, label: "" }]);
  const [classes, setClasses] = useState((event.classes || []).join(", "));

  const [paste, setPaste] = useState("");
  const [replaceList, setReplaceList] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [guestFilter, setGuestFilter] = useState("");

  const filledBooths = booths.map((b) => b.trim()).filter(Boolean);
  const letters = wordLetters(word);
  const mismatch = letters.length !== filledBooths.length;

  /* The same parser the server uses, run on the paste as it is typed. A guest
     list is the one thing here that is copied out of someone else's
     spreadsheet, so showing what WILL be imported before anything is written
     is the difference between a clean list and a hundred rows of rubbish. */
  const preview = useMemo(() => (paste.trim() ? parseInviteeCsv(paste) : null), [paste]);

  const links = useMemo(
    () => ({
      door: `${baseUrl}/q/e/${event.slug}`,
      booth: `${baseUrl}/q/booth`,
      redeem: `${baseUrl}/q/redeem`,
      board: `${baseUrl}/q/board/${event.slug}`,
      poster: `${baseUrl}/qr/${event.id}/poster`,
    }),
    [baseUrl, event.slug, event.id],
  );

  function save(nextStatus = status) {
    setResult(null);
    startTransition(async () => {
      const res = await saveQrSetupAction(event.id, {
        title,
        venueName,
        status: nextStatus,
        intro,
        word,
        pin,
        booths,
        tiers,
        classes: classes.split(",").map((c) => c.trim()).filter(Boolean),
      });
      setResult(res);
      if (res.ok) {
        setStatus(nextStatus);
        router.refresh();
      }
    });
  }

  /* Every list update uses the functional form. The direct version reads the
     array captured by THIS render, so two taps landing in the same frame — an
     impatient double-tap, which is how people use an "add" button — both
     append to the same stale array and one is silently lost. */
  const moveBooth = (from, to) => {
    if (to < 0 || to >= booths.length) return;
    setBooths((prev) => {
      const next = prev.slice();
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  const visibleGuests = useMemo(() => {
    const term = guestFilter.trim().toLowerCase();
    return term ? invitees.filter((i) => i.name.toLowerCase().includes(term)) : invitees;
  }, [invitees, guestFilter]);

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2" role="tablist">
        {TABS.map(([key, name]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => setTab(key)}
            className={`rounded-pill px-4 py-2 text-sm font-semibold transition-colors duration-150 ${
              tab === key ? "bg-ink text-white" : "border border-line text-ink hover:bg-paper-deep"
            }`}
          >
            {name}
          </button>
        ))}
      </div>

      {result && !result.ok ? (
        <div className="mt-4">
          <Notice tone="bad">{result.error}</Notice>
        </div>
      ) : null}
      {result?.ok ? (
        <div className="mt-4">
          <Notice tone="good">Saved.</Notice>
        </div>
      ) : null}

      {/* ---- Setup ---------------------------------------------------- */}
      {tab === "setup" ? (
        <>
          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-heading text-lg font-semibold text-charcoal">
                  {status === "open"
                    ? "Check-in is open"
                    : status === "closed"
                      ? "Check-in is closed"
                      : "Not open yet"}
                </p>
                <p className="mt-0.5 max-w-md text-sm text-charcoal-soft">
                  {status === "open"
                    ? "Families who scan the door QR can register right now."
                    : status === "closed"
                      ? "Nobody new can check in. Passes and the leaderboard still work."
                      : "The door link returns nothing until this is open — so a half-built setup can’t be walked into."}
                </p>
              </div>
              <div className="flex gap-2">
                {status !== "open" ? (
                  <button type="button" disabled={pending} onClick={() => save("open")} className={btn}>
                    Open check-in
                  </button>
                ) : (
                  <button type="button" disabled={pending} onClick={() => save("closed")} className={btnQuiet}>
                    Close check-in
                  </button>
                )}
              </div>
            </div>
          </div>

          <div className={card}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className={label} htmlFor="qr-title">
                  Name
                </label>
                <input id="qr-title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="qr-venue">
                  Where
                </label>
                <input
                  id="qr-venue"
                  value={venueName}
                  onChange={(e) => setVenueName(e.target.value)}
                  className={field}
                />
              </div>
            </div>
          </div>

          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">The booths</h2>
            <p className="mt-1 text-sm text-charcoal-soft">
              In the order families meet them. Each booth hands out one letter of the word below.
            </p>

            <ul className="mt-4 space-y-2">
              {booths.map((name, index) => (
                <li key={index} className="flex items-center gap-2">
                  <span
                    aria-hidden="true"
                    className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-control bg-sand font-heading text-lg font-semibold text-gold-hover"
                  >
                    {letters[index] || "·"}
                  </span>
                  <input
                    value={name}
                    onChange={(e) => {
                      const value = e.target.value;
                      setBooths((prev) => prev.map((b, i) => (i === index ? value : b)));
                    }}
                    placeholder={`Booth ${index + 1}`}
                    aria-label={`Booth ${index + 1} name`}
                    className={field}
                  />
                  <button
                    type="button"
                    onClick={() => moveBooth(index, index - 1)}
                    disabled={index === 0}
                    aria-label={`Move ${name || `booth ${index + 1}`} earlier`}
                    className="rounded-control border border-line p-2 text-ink transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-30"
                  >
                    <Icon name="chevron-down" size={16} className="rotate-180" />
                  </button>
                  <button
                    type="button"
                    onClick={() => moveBooth(index, index + 1)}
                    disabled={index === booths.length - 1}
                    aria-label={`Move ${name || `booth ${index + 1}`} later`}
                    className="rounded-control border border-line p-2 text-ink transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-30"
                  >
                    <Icon name="chevron-down" size={16} />
                  </button>
                  <button
                    type="button"
                    onClick={() => setBooths((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove ${name || `booth ${index + 1}`}`}
                    className="rounded-control border border-line p-2 text-rust transition-transform duration-150 ease-out active:scale-[0.97]"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setBooths((prev) => [...prev, ""])}
              className={`${btnQuiet} mt-3`}
            >
              Add a booth
            </button>

            <div className="mt-6">
              <label className={label} htmlFor="qr-word">
                The word they spell
              </label>
              <input
                id="qr-word"
                value={word}
                onChange={(e) => setWord(e.target.value)}
                placeholder="QURAN"
                className={`${field} font-heading text-lg uppercase tracking-[0.3em]`}
              />
              {/* The one mistake that is invisible until the day itself, so it
                  is stated here in the same breath as the two numbers. */}
              <p className={`mt-2 text-sm ${mismatch ? "text-rust" : "text-charcoal-soft"}`}>
                {letters.length} letter{letters.length === 1 ? "" : "s"} · {filledBooths.length} booth
                {filledBooths.length === 1 ? "" : "s"}
                {mismatch ? " — these must match, or the word can never be completed." : " — a match."}
              </p>
            </div>
          </div>

          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">Prizes</h2>
            <p className="mt-1 text-sm text-charcoal-soft">
              What a family may collect at the prize counter, and how many booths it takes.
            </p>
            <ul className="mt-4 space-y-2">
              {tiers.map((tier, index) => (
                <li key={index} className="flex items-center gap-2">
                  <input
                    type="number"
                    min="1"
                    max={Math.max(1, filledBooths.length)}
                    value={tier.at}
                    onChange={(e) => {
                      const at = Number(e.target.value);
                      setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, at } : t)));
                    }}
                    aria-label={`Booths needed for prize ${index + 1}`}
                    className={`${field} w-20 flex-shrink-0 text-center tabular-nums`}
                  />
                  <input
                    value={tier.label}
                    onChange={(e) => {
                      const value = e.target.value;
                      setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, label: value } : t)));
                    }}
                    placeholder="Sticker sheet"
                    aria-label={`Prize ${index + 1}`}
                    className={field}
                  />
                  <button
                    type="button"
                    onClick={() => setTiers((prev) => prev.filter((_, i) => i !== index))}
                    aria-label={`Remove prize ${index + 1}`}
                    className="rounded-control border border-line p-2 text-rust transition-transform duration-150 ease-out active:scale-[0.97]"
                  >
                    <Icon name="trash" size={16} />
                  </button>
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => setTiers((prev) => [...prev, { at: filledBooths.length || 1, label: "" }])}
              className={`${btnQuiet} mt-3`}
            >
              Add a prize
            </button>
          </div>

          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">The door and the desk</h2>

            <div className="mt-4">
              <label className={label} htmlFor="qr-intro">
                What the check-in page says
              </label>
              <textarea
                id="qr-intro"
                rows={3}
                value={intro}
                onChange={(e) => setIntro(e.target.value)}
                placeholder="Welcome! Find your name to get your pass."
                className={field}
              />
            </div>

            <div className="mt-4">
              <label className={label} htmlFor="qr-classes">
                Class options on the form
              </label>
              <input
                id="qr-classes"
                value={classes}
                onChange={(e) => setClasses(e.target.value)}
                placeholder="Iqra 1, Iqra 2, Quran, Tahfiz"
                className={field}
              />
              <p className="mt-1.5 text-xs text-charcoal-soft">
                Comma separated. Leave empty to skip the question entirely.
              </p>
            </div>

            <div className="mt-4 max-w-xs">
              <label className={label} htmlFor="qr-pin">
                Staff PIN
              </label>
              <input
                id="qr-pin"
                inputMode="numeric"
                value={pin}
                onChange={(e) => setPin(e.target.value.replace(/\D/g, "").slice(0, 8))}
                placeholder="4–8 digits"
                className={`${field} font-heading text-xl tracking-[0.4em]`}
              />
              {/* Said plainly, because it looks like a login and is not one. */}
              <p className="mt-1.5 text-xs text-charcoal-soft">
                One PIN for the whole team, typed once per phone. It keeps parents out of the booth
                screens — it is not a login, so give it a fresh number for every event.
              </p>
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => save()} disabled={pending} className={btn}>
              {pending ? "Saving…" : "Save setup"}
            </button>
            <p className="text-sm text-charcoal-soft">
              You can save a half-finished setup — the checks only run when check-in is opened.
            </p>
          </div>
        </>
      ) : null}

      {/* ---- Guest list ------------------------------------------------ */}
      {tab === "guests" ? (
        <>
          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">Who’s expected</h2>
            <p className="mt-1 text-sm text-charcoal-soft">
              Paste a list — one name per line, or a CSV with <strong>name</strong>,{" "}
              <strong>phone</strong> and <strong>note</strong> columns. Families find their own name
              at the door instead of typing it.
            </p>

            <textarea
              rows={7}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"name,phone,note\nFatimah Rahman,9123 4567,Iqra 2\nAhmad Ismail,,Tahfiz\nSiti Aminah"}
              className={`${field} mt-4 font-mono text-sm`}
              aria-label="Paste the guest list"
            />

            {preview ? (
              <p className="mt-2 text-sm text-charcoal-soft">
                {preview.rows.length} name{preview.rows.length === 1 ? "" : "s"} found
                {preview.usedHeader ? ", using the header row" : ""}
                {preview.skipped ? ` · ${preview.skipped} line${preview.skipped === 1 ? "" : "s"} skipped (blank or repeated)` : ""}
              </p>
            ) : null}

            {preview?.rows.length ? (
              <ul className="mt-3 max-h-40 overflow-y-auto rounded-control border border-line bg-paper p-3 text-sm">
                {preview.rows.slice(0, 12).map((row, i) => (
                  <li key={i} className="truncate text-ink">
                    {row.name}
                    {row.note ? <span className="text-charcoal-soft"> · {row.note}</span> : null}
                    {row.phone ? <span className="text-charcoal-soft"> · {row.phone}</span> : null}
                  </li>
                ))}
                {preview.rows.length > 12 ? (
                  <li className="text-charcoal-soft">…and {preview.rows.length - 12} more</li>
                ) : null}
              </ul>
            ) : null}

            <label className="mt-4 flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={replaceList}
                onChange={(e) => setReplaceList(e.target.checked)}
                className="h-4 w-4 accent-[color:var(--color-gold)]"
              />
              Replace the list instead of adding to it
            </label>
            {replaceList ? (
              <p className="mt-1.5 text-xs text-charcoal-soft">
                Anyone who has already checked in stays on the list — removing them would orphan a
                family standing in the hall holding a pass.
              </p>
            ) : null}

            {importResult ? (
              <div className="mt-4">
                {importResult.ok ? (
                  <Notice tone="good">
                    Added {importResult.added} name{importResult.added === 1 ? "" : "s"}
                    {importResult.duplicates
                      ? ` · skipped ${importResult.duplicates} already on the list or blank`
                      : ""}
                    .
                  </Notice>
                ) : (
                  <Notice tone="bad">{importResult.error}</Notice>
                )}
              </div>
            ) : null}

            <div className="mt-4 flex flex-wrap gap-3">
              <button
                type="button"
                disabled={pending || !preview?.rows.length}
                onClick={() =>
                  startTransition(async () => {
                    const res = await importInviteesAction(event.id, paste, { replace: replaceList });
                    setImportResult(res);
                    if (res.ok) {
                      setPaste("");
                      router.refresh();
                    }
                  })
                }
                className={btn}
              >
                {pending ? "Importing…" : "Import"}
              </button>
              {invitees.length ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await clearInviteesAction(event.id);
                      setImportResult(null);
                      router.refresh();
                    })
                  }
                  className={btnQuiet}
                >
                  Clear the list
                </button>
              ) : null}
            </div>
          </div>

          {invitees.length ? (
            <div className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold text-charcoal">
                  {stats.arrived} of {stats.total} arrived
                </h2>
                <p className="text-sm text-charcoal-soft">
                  {stats.awaited} still to come
                </p>
              </div>

              <div
                className="mt-3 flex h-2 w-full overflow-hidden rounded-pill bg-paper-deep"
                role="img"
                aria-label={`${stats.arrived} of ${stats.total} expected guests have checked in`}
              >
                <span
                  className="bg-gold transition-[width] duration-300 ease-out"
                  style={{ width: `${stats.total ? (stats.arrived / stats.total) * 100 : 0}%` }}
                />
              </div>

              <input
                value={guestFilter}
                onChange={(e) => setGuestFilter(e.target.value)}
                placeholder="Find a name"
                aria-label="Find a name on the guest list"
                className={`${field} mt-4`}
              />

              <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto">
                {visibleGuests.map((guest) => (
                  <li key={guest.id} className="flex items-center gap-3 py-2.5">
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control ${
                        guest.family_id ? "bg-gold-soft text-ink" : "bg-paper-deep text-charcoal-soft"
                      }`}
                    >
                      <Icon name={guest.family_id ? "check" : "user"} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{guest.name}</span>
                      {guest.note || guest.phone ? (
                        <span className="block truncate text-xs text-charcoal-soft">
                          {[guest.note, guest.phone].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex-shrink-0 text-xs text-charcoal-soft">
                      {guest.family_id ? "Here" : "Not yet"}
                    </span>
                  </li>
                ))}
                {visibleGuests.length === 0 ? (
                  <li className="py-3 text-sm text-charcoal-soft">Nobody matches “{guestFilter}”.</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ---- On the day ----------------------------------------------- */}
      {tab === "hall" ? (
        <>
          {status !== "open" ? (
            <div className="mt-4">
              <Notice>Check-in isn’t open, so the door link is not live yet.</Notice>
            </div>
          ) : null}

          <div className={card}>
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div className="rounded-card border border-line bg-white p-3">{doorQr}</div>
              <div className="min-w-0">
                <h2 className="font-heading text-lg font-semibold text-charcoal">The door code</h2>
                <p className="mt-1 text-sm text-charcoal-soft">
                  This is the only QR a family scans on the way in. Print it big, put it at eye
                  level, and put a second one where the queue actually forms.
                </p>
                <Link href={`/qr/${event.id}/poster`} target="_blank" className={`${btnQuiet} mt-4 inline-block`}>
                  Open the printable poster
                </Link>
              </div>
            </div>
          </div>

          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">Links for the team</h2>
            <div className="mt-3">
              <LinkRow icon="user-plus" title="Check-in" hint="Where the door QR sends a family" url={links.door} />
              <LinkRow
                icon="camera"
                title="Booth scanner"
                hint="Every volunteer opens this once, enters the PIN, and picks their booth"
                url={links.booth}
              />
              <LinkRow
                icon="gem"
                title="Prize counter"
                hint="Looks a family up and marks a prize as given"
                url={links.redeem}
              />
              <LinkRow
                icon="trophy"
                title="Leaderboard"
                hint="For the TV in the hall — no PIN, nicknames only"
                url={links.board}
              />
            </div>
          </div>

          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["families", stats.families, "checked in"],
              ["members", stats.members, "people named"],
              ["visits", stats.visits, "letters given"],
              ["prizes", stats.prizes, "prizes given"],
            ].map(([key, value, text]) => (
              <div key={key} className="rounded-card border border-line bg-white p-4">
                <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
                <p className="text-sm text-charcoal-soft">{text}</p>
              </div>
            ))}
          </div>

          {stats.perBooth.length ? (
            <div className={card}>
              <h2 className="font-heading text-lg font-semibold text-charcoal">Booth by booth</h2>
              <p className="mt-1 text-sm text-charcoal-soft">
                {stats.finished} famil{stats.finished === 1 ? "y has" : "ies have"} completed the word.
              </p>
              <ul className="mt-4 space-y-3">
                {stats.perBooth.map((booth) => {
                  const share = stats.families ? (booth.visits / stats.families) * 100 : 0;
                  return (
                    <li key={booth.id}>
                      <div className="flex items-baseline justify-between gap-3">
                        <span className="truncate text-sm font-semibold text-ink">{booth.name}</span>
                        <span className="flex-shrink-0 text-sm tabular-nums text-charcoal-soft">
                          {booth.visits}
                        </span>
                      </div>
                      <div
                        className="mt-1.5 h-2 w-full overflow-hidden rounded-pill bg-paper-deep"
                        role="img"
                        aria-label={`${booth.visits} of ${stats.families} families`}
                      >
                        <span
                          className="block h-full rounded-pill bg-gold transition-[width] duration-300 ease-out"
                          style={{ width: `${Math.min(100, share)}%` }}
                        />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ---- Checked in ------------------------------------------------ */}
      {tab === "families" ? (
        <div className={card}>
          <h2 className="font-heading text-lg font-semibold text-charcoal">
            {families.length} famil{families.length === 1 ? "y" : "ies"}
          </h2>
          {families.length ? (
            <div className="mt-4 overflow-x-auto">
              <table className="w-full min-w-[34rem] text-left text-sm">
                <thead>
                  <tr className="border-b border-line text-xs uppercase tracking-wider text-charcoal-soft">
                    <th className="pb-2 pr-3 font-semibold">Family</th>
                    <th className="pb-2 pr-3 font-semibold">Code</th>
                    <th className="pb-2 pr-3 font-semibold">People</th>
                    <th className="pb-2 font-semibold">Letters</th>
                  </tr>
                </thead>
                <tbody>
                  {families.map((family) => (
                    <tr key={family.id} className="border-b border-line last:border-b-0">
                      <td className="py-2.5 pr-3">
                        <span className="font-semibold text-ink">{displayName(family)}</span>
                        {family.parent_name ? (
                          <span className="block text-xs text-charcoal-soft">{family.parent_name}</span>
                        ) : null}
                      </td>
                      <td className="py-2.5 pr-3 font-mono text-xs tabular-nums text-charcoal-soft">
                        {formatToken(family.token)}
                      </td>
                      <td className="py-2.5 pr-3 tabular-nums text-charcoal-soft">
                        {family.member_count}
                      </td>
                      <td className="py-2.5 tabular-nums text-ink">
                        {family.collected} / {event.booths.length}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <p className="mt-3 text-sm text-charcoal-soft">
              Nobody has checked in yet. The first family to scan the door code appears here.
            </p>
          )}
        </div>
      ) : null}
    </>
  );
}
