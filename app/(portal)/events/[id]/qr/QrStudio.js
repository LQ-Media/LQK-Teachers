"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { wordLetters, formatToken, displayName } from "@/lib/events/passport";
import { saveQrSetupAction } from "./actions";

const TABS = [
  ["setup", "Setup"],
  ["hall", "On the day"],
  ["families", "Families"],
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

export default function QrStudio({ event, stats, families, baseUrl, doorQr }) {
  const router = useRouter();
  const [tab, setTab] = useState("setup");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState(null);

  const [enabled, setEnabled] = useState(!!event.qr_enabled);
  const [intro, setIntro] = useState(event.qr_intro || "");
  const [word, setWord] = useState(event.qr_word || "");
  const [pin, setPin] = useState(event.qr_pin || "");
  const [booths, setBooths] = useState(
    event.booths.length ? event.booths.map((b) => b.name) : [""],
  );
  const [tiers, setTiers] = useState(
    event.tiers.length ? event.tiers : [{ at: 3, label: "" }],
  );
  const [classes, setClasses] = useState((event.classes || []).join(", "));

  const filledBooths = booths.map((b) => b.trim()).filter(Boolean);
  const letters = wordLetters(word);
  const mismatch = letters.length !== filledBooths.length;

  const links = useMemo(
    () => ({
      door: `${baseUrl}/q/e/${event.slug}`,
      booth: `${baseUrl}/q/booth`,
      redeem: `${baseUrl}/q/redeem`,
      board: `${baseUrl}/q/board/${event.slug}`,
      poster: `${baseUrl}/events/${event.id}/qr/poster`,
    }),
    [baseUrl, event.slug, event.id],
  );

  function save(nextEnabled = enabled) {
    setResult(null);
    startTransition(async () => {
      const res = await saveQrSetupAction(event.id, {
        enabled: nextEnabled,
        intro,
        word,
        pin,
        booths,
        tiers,
        classes: classes.split(",").map((c) => c.trim()).filter(Boolean),
      });
      setResult(res);
      if (res.ok) {
        setEnabled(nextEnabled);
        router.refresh();
      }
    });
  }

  /* Every list update uses the functional form. The direct version reads the
     `booths` captured by THIS render, so two taps landing in the same frame —
     an impatient double-tap, which is how people use an "add" button — both
     append to the same stale array and one of them is silently lost. */
  const moveBooth = (from, to) => {
    if (to < 0 || to >= booths.length) return;
    setBooths((prev) => {
      const next = prev.slice();
      [next[from], next[to]] = [next[to], next[from]];
      return next;
    });
  };

  return (
    <>
      <div className="mt-6 flex flex-wrap gap-2" role="tablist">
        {TABS.map(([key, title]) => (
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
            {title}
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
                  {enabled ? "Check-in is open" : "Check-in is off"}
                </p>
                <p className="mt-0.5 text-sm text-charcoal-soft">
                  {enabled
                    ? "Families who scan the door QR can register right now."
                    : "The door link returns nothing until this is on — so a half-built setup can’t be walked into."}
                </p>
              </div>
              <button
                type="button"
                disabled={pending}
                onClick={() => save(!enabled)}
                className={enabled ? btnQuiet : btn}
              >
                {enabled ? "Close check-in" : "Open check-in"}
              </button>
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

            <button type="button" onClick={() => setBooths((prev) => [...prev, ""])} className={`${btnQuiet} mt-3`}>
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
                className={`${field} font-heading text-lg tracking-[0.3em] uppercase`}
              />
              {/* The one mistake that is invisible until the day itself, so it
                  is stated here in the same breath as the two numbers. */}
              <p className={`mt-2 text-sm ${mismatch ? "text-rust" : "text-charcoal-soft"}`}>
                {letters.length} letter{letters.length === 1 ? "" : "s"} · {filledBooths.length} booth
                {filledBooths.length === 1 ? "" : "s"}
                {mismatch
                  ? " — these must match, or the word can never be completed."
                  : " — a match."}
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
                      const label = e.target.value;
                      setTiers((prev) => prev.map((t, i) => (i === index ? { ...t, label } : t)));
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
                placeholder="Welcome! Register your family to start collecting letters around the hall."
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

      {/* ---- On the day ----------------------------------------------- */}
      {tab === "hall" ? (
        <>
          {!enabled ? (
            <div className="mt-4">
              <Notice>Check-in is closed, so the door link is not live yet.</Notice>
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
                <Link href={links.poster} target="_blank" className={`${btnQuiet} mt-4 inline-block`}>
                  Open the printable poster
                </Link>
              </div>
            </div>
          </div>

          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">Links for the team</h2>
            <div className="mt-3">
              <LinkRow
                icon="user-plus"
                title="Check-in"
                hint="Where the door QR sends a family"
                url={links.door}
              />
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
              ["families", stats.families, "registered"],
              ["children", stats.children, "children"],
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

      {/* ---- Families -------------------------------------------------- */}
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
                    <th className="pb-2 pr-3 font-semibold">Contact</th>
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
                      <td className="py-2.5 pr-3 text-charcoal-soft">{family.phone || "—"}</td>
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
