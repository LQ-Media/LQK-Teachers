"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";
import { formatToken, partyName } from "@/lib/qr/tokens";
import { parseInviteeCsv } from "@/lib/qr/csv";
import { FIELD_TYPES } from "@/lib/qr/fields";
import { ASSET_KINDS, ASPECT_RATIOS, DEFAULT_ASPECT, MAX_ASSET_BYTES } from "@/lib/qr/asset-kinds";
import { shrinkImage } from "@/lib/qr/shrink";
import {
  saveQrEventAction,
  importExpectedAction,
  clearExpectedAction,
  uploadAssetAction,
  deleteAssetAction,
  deletePhotoAction,
} from "./actions";

const TABS = [
  ["setup", "Setup"],
  ["expected", "Who's coming"],
  ["photo", "Family photo"],
  ["register", "Register"],
];

const field =
  "w-full rounded-control border border-line bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-gold";
const label = "mb-1.5 block text-sm font-semibold text-ink";
const card = "mt-6 rounded-card border border-line bg-white p-5 sm:p-6";
const btn =
  "rounded-pill bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60";
const btnQuiet =
  "rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60";

const FIELD_TYPE_LABEL = {
  text: "Text",
  tel: "Phone",
  email: "Email",
  choice: "Pick one",
  yesno: "Yes / no",
  note: "Long note",
};

function Notice({ tone = "warn", children }) {
  const tones = {
    warn: "bg-sand text-gold-hover",
    bad: "bg-rust-soft text-rust",
    good: "bg-gold-soft text-ink",
  };
  return <p className={`rounded-control px-3 py-2 text-sm ${tones[tone]}`}>{children}</p>;
}

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

export default function AttendanceStudio({
  event,
  stats,
  registrations,
  expected,
  baseUrl,
  hasGemini,
  doorQr,
}) {
  const router = useRouter();
  const [tab, setTab] = useState("setup");
  const [pending, startTransition] = useTransition();
  const [result, setResult] = useState(null);

  const [title, setTitle] = useState(event.title || "");
  const [venueName, setVenueName] = useState(event.venue_name || "");
  const [startsAt, setStartsAt] = useState(event.starts_at || "");
  const [status, setStatus] = useState(event.status);
  const [intro, setIntro] = useState(event.intro || "");
  const [fields, setFields] = useState(event.fields || []);
  const [askPax, setAskPax] = useState(Boolean(event.ask_pax));
  const [paxLabel, setPaxLabel] = useState(event.pax_label || "");

  const [photoEnabled, setPhotoEnabled] = useState(Boolean(event.photo_enabled));
  const [photoPrompt, setPhotoPrompt] = useState(event.photo_prompt || "");
  const [photoAspect, setPhotoAspect] = useState(event.photo_aspect || DEFAULT_ASPECT);
  const [photoBlurb, setPhotoBlurb] = useState(event.photo_blurb || "");
  const [photoConsentText, setPhotoConsentText] = useState(event.photo_consent_text || "");

  const [paste, setPaste] = useState("");
  const [replaceList, setReplaceList] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [listFilter, setListFilter] = useState("");

  const [uploadKind, setUploadKind] = useState("background");
  const [uploadLabel, setUploadLabel] = useState("");
  const [uploadError, setUploadError] = useState(null);
  const fileRef = useRef(null);

  /* The same parser the server uses, run on the paste as it is typed. A list is
     copied out of someone else's spreadsheet, so showing what WILL be imported
     before anything is written is the difference between a clean register and a
     hundred rows of rubbish. */
  const preview = useMemo(() => (paste.trim() ? parseInviteeCsv(paste) : null), [paste]);

  const links = useMemo(
    () => ({
      door: `${baseUrl}/q/e/${event.slug}`,
      poster: `${baseUrl}/qr/${event.id}/poster`,
      csv: `${baseUrl}/api/qr/${event.id}/csv`,
    }),
    [baseUrl, event.slug, event.id],
  );

  const visibleExpected = useMemo(() => {
    const term = listFilter.trim().toLowerCase();
    if (!term) return expected;
    return expected.filter(
      (row) =>
        row.name.toLowerCase().includes(term) || (row.class_name || "").toLowerCase().includes(term),
    );
  }, [expected, listFilter]);

  function save(nextStatus = status) {
    setResult(null);
    startTransition(async () => {
      const res = await saveQrEventAction(event.id, {
        title,
        venueName,
        startsAt,
        status: nextStatus,
        intro,
        fields,
        askPax,
        paxLabel,
        photoEnabled,
        photoPrompt,
        photoAspect,
        photoBlurb,
        photoConsentText,
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
     impatient double-tap, which is how people use an "add" button — both append
     to the same stale array and one is silently lost. */
  const setField = (index, patch) =>
    setFields((prev) => prev.map((f, i) => (i === index ? { ...f, ...patch } : f)));

  async function onPickFile(file) {
    setUploadError(null);
    if (!file) return;
    // Shrunk in the browser first: a 12 MP background straight off a phone is
    // 6 MB, and the server action ceiling is 10 MB for the whole request.
    // shrinkImage keeps PNG as PNG — a logo re-encoded to JPEG loses its
    // transparency to a black rectangle, which then gets composited into every
    // family's picture.
    const shrunk = await shrinkImage(file).catch(() => null);
    if (!shrunk) {
      setUploadError("That file could not be read as an image. Try a JPEG or PNG.");
      return;
    }
    if (shrunk.dataUrl.length * 0.75 > MAX_ASSET_BYTES) {
      setUploadError("That image is too large even after shrinking.");
      return;
    }
    startTransition(async () => {
      const res = await uploadAssetAction(event.id, {
        kind: uploadKind,
        label: uploadLabel,
        dataUrl: shrunk.dataUrl,
      });
      if (!res.ok) setUploadError(res.error);
      else {
        setUploadLabel("");
        router.refresh();
      }
      if (fileRef.current) fileRef.current.value = "";
    });
  }

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

      {/* ---- Setup ----------------------------------------------------- */}
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
                    ? "Families who scan the door QR can check themselves in right now."
                    : status === "closed"
                      ? "Nobody new can check in. Existing passes and photos still work."
                      : "The door link returns nothing until this is open — so a half-built event can’t be walked into."}
                </p>
              </div>
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

          <div className={card}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className={label} htmlFor="qr-title">Event name</label>
                <input id="qr-title" value={title} onChange={(e) => setTitle(e.target.value)} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="qr-venue">Where</label>
                <input id="qr-venue" value={venueName} onChange={(e) => setVenueName(e.target.value)} className={field} />
              </div>
              <div>
                <label className={label} htmlFor="qr-date">When</label>
                <input id="qr-date" type="date" value={startsAt || ""} onChange={(e) => setStartsAt(e.target.value)} className={field} />
              </div>
              <div className="sm:col-span-2">
                <label className={label} htmlFor="qr-intro">What the check-in page says</label>
                <textarea
                  id="qr-intro"
                  rows={3}
                  value={intro}
                  onChange={(e) => setIntro(e.target.value)}
                  placeholder="Welcome! Find your child's name to check your family in."
                  className={field}
                />
              </div>
            </div>
          </div>

          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">Extra details to collect</h2>
            <p className="mt-1 text-sm text-charcoal-soft">
              Asked once per family at check-in, on top of everyone’s name and class. Leave empty to
              ask nothing extra.
            </p>

            <ul className="mt-4 space-y-3">
              {fields.map((f, index) => (
                <li key={index} className="rounded-control border border-line bg-paper p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <input
                      value={f.label}
                      onChange={(e) => setField(index, { label: e.target.value })}
                      placeholder="Any dietary needs?"
                      aria-label={`Question ${index + 1}`}
                      className="min-w-0 flex-1 rounded-control border border-line bg-white px-3 py-2.5 text-base text-ink outline-none focus:border-gold"
                    />
                    <select
                      value={f.type}
                      onChange={(e) => setField(index, { type: e.target.value })}
                      aria-label={`Question ${index + 1} answer type`}
                      className="flex-shrink-0 rounded-control border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-gold"
                    >
                      {FIELD_TYPES.map((type) => (
                        <option key={type} value={type}>{FIELD_TYPE_LABEL[type]}</option>
                      ))}
                    </select>
                    <button
                      type="button"
                      onClick={() => setFields((prev) => prev.filter((_, i) => i !== index))}
                      aria-label={`Remove question ${index + 1}`}
                      className="flex-shrink-0 rounded-control border border-line p-2 text-rust transition-transform duration-150 ease-out active:scale-[0.97]"
                    >
                      <Icon name="trash" size={16} />
                    </button>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        checked={Boolean(f.required)}
                        onChange={(e) => setField(index, { required: e.target.checked })}
                        className="h-4 w-4 accent-[color:var(--color-gold)]"
                      />
                      Required
                    </label>
                    {f.type === "choice" ? (
                      <input
                        value={(f.options || []).join(", ")}
                        onChange={(e) =>
                          setField(index, { options: e.target.value.split(",").map((o) => o.trim()).filter(Boolean) })
                        }
                        placeholder="Car, Bus, Walking"
                        aria-label={`Question ${index + 1} options`}
                        className="min-w-0 flex-1 rounded-control border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-gold"
                      />
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>

            <button
              type="button"
              onClick={() => setFields((prev) => [...prev, { label: "", type: "text", options: [], required: false }])}
              className={`${btnQuiet} mt-3`}
            >
              Add a question
            </button>

            <div className="mt-6 border-t border-line pt-5">
              <label className="flex items-start gap-3 text-sm text-ink">
                <input
                  type="checkbox"
                  checked={askPax}
                  onChange={(e) => setAskPax(e.target.checked)}
                  className="mt-0.5 h-5 w-5 flex-shrink-0 accent-[color:var(--color-gold)]"
                />
                <span>
                  <span className="block font-semibold">Ask how many others are with them</span>
                  {/* Said plainly because the two are easy to confuse: this is
                      a NUMBER for people who are never named, and it is added
                      to the named list rather than replacing it. */}
                  <span className="mt-0.5 block text-charcoal-soft">
                    A simple count for anyone they don’t want to name — a grandmother, a neighbour’s
                    child. Added on top of the people they list, so the headcount is always right.
                    Leaving it at zero is fine.
                  </span>
                </span>
              </label>

              {askPax ? (
                <div className="mt-3 pl-8">
                  <label className={label} htmlFor="qr-pax-label">
                    How to word it
                  </label>
                  <input
                    id="qr-pax-label"
                    value={paxLabel}
                    onChange={(e) => setPaxLabel(e.target.value)}
                    placeholder="How many others are with you?"
                    className={field}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className={card}>
            <div className="flex flex-col items-start gap-6 sm:flex-row sm:items-center">
              <div className="rounded-card border border-line bg-white p-3">{doorQr}</div>
              <div className="min-w-0">
                <h2 className="font-heading text-lg font-semibold text-charcoal">The door code</h2>
                <p className="mt-1 text-sm text-charcoal-soft">
                  The only QR a family scans. Print it big, put it at eye level, and put a second one
                  where the queue actually forms.
                </p>
                <Link href={`/qr/${event.id}/poster`} target="_blank" className={`${btnQuiet} mt-4 inline-block`}>
                  Open the printable poster
                </Link>
              </div>
            </div>
            <div className="mt-4">
              <LinkRow icon="user-plus" title="Check-in" hint="Where the door QR sends a family" url={links.door} />
            </div>
          </div>

          <div className="mt-6 flex flex-wrap items-center gap-3">
            <button type="button" onClick={() => save()} disabled={pending} className={btn}>
              {pending ? "Saving…" : "Save"}
            </button>
            <p className="text-sm text-charcoal-soft">
              You can save a half-finished setup — the checks only run when check-in is opened.
            </p>
          </div>
        </>
      ) : null}

      {/* ---- Who's coming ---------------------------------------------- */}
      {tab === "expected" ? (
        <>
          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">Upload the list</h2>
            <p className="mt-1 text-sm text-charcoal-soft">
              Paste a CSV with <strong>name</strong> and <strong>class</strong> columns — plus{" "}
              <strong>phone</strong> and <strong>note</strong> if you have them. Families find their
              own name at the door instead of typing it, and their class comes with it.
            </p>

            <textarea
              rows={7}
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder={"name,class,phone\nAisyah Rahman,Iqra 2,9123 4567\nYusuf Rahman,Quran\nAhmad Ismail,Tahfiz"}
              className={`${field} mt-4 font-mono text-sm`}
              aria-label="Paste the list"
            />

            {preview ? (
              <p className="mt-2 text-sm text-charcoal-soft">
                {preview.rows.length} name{preview.rows.length === 1 ? "" : "s"} found
                {preview.usedHeader ? ", using the header row" : ""}
                {preview.skipped
                  ? ` · ${preview.skipped} line${preview.skipped === 1 ? "" : "s"} skipped (blank or repeated)`
                  : ""}
              </p>
            ) : null}

            {preview?.rows.length ? (
              <ul className="mt-3 max-h-40 overflow-y-auto rounded-control border border-line bg-paper p-3 text-sm">
                {preview.rows.slice(0, 12).map((row, i) => (
                  <li key={i} className="truncate text-ink">
                    {row.name}
                    {row.className ? <span className="text-charcoal-soft"> · {row.className}</span> : null}
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
                Anyone already marked present stays — removing them would orphan an attendance record
                for someone who was actually there.
              </p>
            ) : null}

            {importResult ? (
              <div className="mt-4">
                {importResult.ok ? (
                  <Notice tone="good">
                    Added {importResult.added} name{importResult.added === 1 ? "" : "s"}
                    {importResult.duplicates ? ` · skipped ${importResult.duplicates} already listed or blank` : ""}.
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
                    const res = await importExpectedAction(event.id, paste, { replace: replaceList });
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
              {expected.length ? (
                <button
                  type="button"
                  disabled={pending}
                  onClick={() =>
                    startTransition(async () => {
                      await clearExpectedAction(event.id);
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

          {expected.length ? (
            <div className={card}>
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="font-heading text-lg font-semibold text-charcoal">
                  {stats.arrived} of {stats.expected} here
                </h2>
                <p className="text-sm text-charcoal-soft">{stats.awaited} still to come</p>
              </div>
              <div
                className="mt-3 flex h-2 w-full overflow-hidden rounded-pill bg-paper-deep"
                role="img"
                aria-label={`${stats.arrived} of ${stats.expected} expected people have checked in`}
              >
                <span
                  className="bg-gold transition-[width] duration-300 ease-out"
                  style={{ width: `${stats.expected ? (stats.arrived / stats.expected) * 100 : 0}%` }}
                />
              </div>

              <input
                value={listFilter}
                onChange={(e) => setListFilter(e.target.value)}
                placeholder="Find a name or class"
                aria-label="Find a name or class"
                className={`${field} mt-4`}
              />

              <ul className="mt-3 max-h-96 divide-y divide-line overflow-y-auto">
                {visibleExpected.map((row) => (
                  <li key={row.id} className="flex items-center gap-3 py-2.5">
                    <span
                      aria-hidden="true"
                      className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-control ${
                        row.attendance_id ? "bg-gold-soft text-ink" : "bg-paper-deep text-charcoal-soft"
                      }`}
                    >
                      <Icon name={row.attendance_id ? "check" : "user"} size={15} />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-ink">{row.name}</span>
                      {row.class_name || row.phone ? (
                        <span className="block truncate text-xs text-charcoal-soft">
                          {[row.class_name, row.phone].filter(Boolean).join(" · ")}
                        </span>
                      ) : null}
                    </span>
                    <span className="flex-shrink-0 text-xs text-charcoal-soft">
                      {row.attendance_id ? "Here" : "Not yet"}
                    </span>
                  </li>
                ))}
                {visibleExpected.length === 0 ? (
                  <li className="py-3 text-sm text-charcoal-soft">Nobody matches “{listFilter}”.</li>
                ) : null}
              </ul>
            </div>
          ) : null}
        </>
      ) : null}

      {/* ---- Family photo ---------------------------------------------- */}
      {tab === "photo" ? (
        <>
          {!hasGemini ? (
            <div className="mt-4">
              <Notice tone="bad">
                GEMINI_API_KEY isn’t set on this server, so no picture can be generated. Everything
                below can still be set up.
              </Notice>
            </div>
          ) : null}

          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="max-w-md">
                <p className="font-heading text-lg font-semibold text-charcoal">
                  {photoEnabled ? "Families can send a photo" : "Family photo is off"}
                </p>
                <p className="mt-0.5 text-sm text-charcoal-soft">
                  When it’s on, every pass gets an “Add your family photo” button. The photo they
                  send is used to make the picture and then thrown away — only the finished picture
                  is kept.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPhotoEnabled((on) => !on)}
                className={photoEnabled ? btnQuiet : btn}
              >
                {photoEnabled ? "Turn off" : "Turn on"}
              </button>
            </div>
          </div>

          {stats.photos ? (
            <div className={card}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-heading text-lg font-semibold text-charcoal">
                    {stats.photos} picture{stats.photos === 1 ? "" : "s"} made
                  </p>
                  <p className="mt-0.5 text-sm text-charcoal-soft">
                    A wall of every family picture, with a full-screen slideshow to project or
                    screen-share. Any signed-in teacher can open it.
                  </p>
                </div>
                <Link href={`/qr/${event.id}/gallery`} className={btnQuiet}>
                  Open the gallery
                </Link>
              </div>
            </div>
          ) : null}

          <div className={card}>
            <h2 className="font-heading text-lg font-semibold text-charcoal">The artwork</h2>
            <p className="mt-1 text-sm text-charcoal-soft">
              All optional. Whatever you upload is sent alongside the family’s photo, each one
              labelled so the model knows what it is.
            </p>

            <ul className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
              {event.assets.map((asset) => (
                <li key={asset.id} className="rounded-control border border-line bg-paper p-2">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={`/api/qr/asset/${asset.id}`}
                    alt={asset.label || asset.kind}
                    className="h-24 w-full rounded-[8px] bg-white object-contain"
                  />
                  <p className="mt-1.5 truncate text-xs font-semibold text-ink">
                    {ASSET_KINDS.find((k) => k.kind === asset.kind)?.label || asset.kind}
                  </p>
                  {asset.label ? (
                    <p className="truncate text-[11px] text-charcoal-soft">{asset.label}</p>
                  ) : null}
                  <button
                    type="button"
                    disabled={pending}
                    onClick={() =>
                      startTransition(async () => {
                        await deleteAssetAction(event.id, asset.id);
                        router.refresh();
                      })
                    }
                    className="mt-1 text-xs font-semibold text-rust underline"
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>

            <div className="mt-4 rounded-control border border-line bg-paper p-3">
              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={uploadKind}
                  onChange={(e) => setUploadKind(e.target.value)}
                  aria-label="What kind of artwork"
                  className="rounded-control border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-gold"
                >
                  {ASSET_KINDS.map((k) => (
                    <option key={k.kind} value={k.kind}>{k.label}</option>
                  ))}
                </select>
                <input
                  value={uploadLabel}
                  onChange={(e) => setUploadLabel(e.target.value)}
                  placeholder="Name it — optional, e.g. “Maulid wordmark”"
                  aria-label="Name for this artwork"
                  className="min-w-0 flex-1 rounded-control border border-line bg-white px-3 py-2.5 text-sm text-ink outline-none focus:border-gold"
                />
              </div>
              <input
                ref={fileRef}
                type="file"
                accept="image/png,image/jpeg,image/webp"
                onChange={(e) => onPickFile(e.target.files?.[0])}
                aria-label="Choose an image to upload"
                className="mt-3 w-full text-sm text-charcoal-soft file:mr-3 file:rounded-pill file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
              {/* Said out loud because a one-of-each list is the obvious
                  assumption, and two event logos is a normal thing to have. */}
              <p className="mt-2 text-xs text-charcoal-soft">
                Add as many as you like of any kind — two event logos, three sponsors. The name is
                what the picture generator is told the image is, so your prompt can refer to it.
              </p>
            </div>
            {uploadError ? (
              <div className="mt-3">
                <Notice tone="bad">{uploadError}</Notice>
              </div>
            ) : null}
          </div>

          <div className={card}>
            <label className={label} htmlFor="qr-photo-prompt">
              What should the picture be?
            </label>
            <textarea
              id="qr-photo-prompt"
              rows={4}
              value={photoPrompt}
              onChange={(e) => setPhotoPrompt(e.target.value)}
              placeholder="Place the family standing together in front of the mosque archway on the background, warm evening light, event logo top right, sponsor logo along the bottom edge."
              className={field}
            />
            <p className="mt-1.5 text-xs text-charcoal-soft">
              Your words go first and the house rules follow — the family’s faces are never altered,
              nobody is added or removed, and logos are reproduced rather than redrawn.
            </p>

            <div className="mt-5 max-w-sm">
              <label className={label} htmlFor="qr-photo-aspect">
                Shape of the picture
              </label>
              <select
                id="qr-photo-aspect"
                value={photoAspect}
                onChange={(e) => setPhotoAspect(e.target.value)}
                className={field}
              >
                {ASPECT_RATIOS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label} — {r.hint}
                  </option>
                ))}
              </select>
            </div>

            <div className="mt-5">
              <label className={label} htmlFor="qr-photo-blurb">
                How the pass asks for it
              </label>
              <input
                id="qr-photo-blurb"
                value={photoBlurb}
                onChange={(e) => setPhotoBlurb(e.target.value)}
                placeholder="Send us a family photo and we’ll turn it into your Open House picture."
                className={field}
              />
            </div>

            <div className="mt-5">
              <label className={label} htmlFor="qr-photo-consent">
                What the parent agrees to
              </label>
              <textarea
                id="qr-photo-consent"
                rows={3}
                value={photoConsentText}
                onChange={(e) => setPhotoConsentText(e.target.value)}
                placeholder="I agree to Little Quran Kids using this photo to create our event picture…"
                className={field}
              />
              {/* Stated here rather than in a handoff nobody reads at 9pm the
                  night before an event. */}
              <p className="mt-1.5 text-xs text-charcoal-soft">
                Shown as a tick-box the parent must tick before uploading, and stored word-for-word
                with the picture — “they agreed” is worth nothing without what they agreed to.
                Required before you can open an event that asks for photos.
              </p>
            </div>
          </div>

          <div className="mt-6">
            <button type="button" onClick={() => save()} disabled={pending} className={btn}>
              {pending ? "Saving…" : "Save"}
            </button>
          </div>
        </>
      ) : null}

      {/* ---- Register --------------------------------------------------- */}
      {tab === "register" ? (
        <>
          <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              ["people", stats.people, stats.unnamed ? `here (${stats.unnamed} not named)` : "people here"],
              ["parties", stats.parties, "families"],
              ["children", stats.children, "children named"],
              ["photos", stats.photos, "photos made"],
            ].map(([key, value, text]) => (
              <div key={key} className="rounded-card border border-line bg-white p-4">
                <p className="text-2xl font-semibold tabular-nums text-ink">{value}</p>
                <p className="text-sm text-charcoal-soft">{text}</p>
              </div>
            ))}
          </div>

          {stats.perClass.length ? (
            <div className={card}>
              <h2 className="font-heading text-lg font-semibold text-charcoal">By class</h2>
              <ul className="mt-4 space-y-3">
                {stats.perClass.map((row) => (
                  <li key={row.class_name}>
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-ink">{row.class_name}</span>
                      <span className="flex-shrink-0 text-sm tabular-nums text-charcoal-soft">{row.n}</span>
                    </div>
                    <div
                      className="mt-1.5 h-2 w-full overflow-hidden rounded-pill bg-paper-deep"
                      role="img"
                      aria-label={`${row.n} of ${stats.people} people`}
                    >
                      <span
                        className="block h-full rounded-pill bg-gold transition-[width] duration-300 ease-out"
                        style={{ width: `${stats.people ? (row.n / stats.people) * 100 : 0}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          <div className={card}>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="font-heading text-lg font-semibold text-charcoal">
                {registrations.length} famil{registrations.length === 1 ? "y" : "ies"} checked in
              </h2>
              {registrations.length ? (
                <a href={links.csv} className={btnQuiet}>
                  Download the register
                </a>
              ) : null}
            </div>

            {registrations.length ? (
              <div className="mt-4 overflow-x-auto">
                <table className="w-full min-w-[36rem] text-left text-sm">
                  <thead>
                    <tr className="border-b border-line text-xs uppercase tracking-wider text-charcoal-soft">
                      <th className="pb-2 pr-3 font-semibold">Family</th>
                      <th className="pb-2 pr-3 font-semibold">Code</th>
                      <th className="pb-2 pr-3 font-semibold">People</th>
                      <th className="pb-2 font-semibold">Photo</th>
                    </tr>
                  </thead>
                  <tbody>
                    {registrations.map((row) => (
                      <tr key={row.id} className="border-b border-line last:border-b-0">
                        <td className="py-2.5 pr-3">
                          <span className="font-semibold text-ink">{partyName(row)}</span>
                          {row.contact_name ? (
                            <span className="block text-xs text-charcoal-soft">{row.contact_name}</span>
                          ) : null}
                        </td>
                        <td className="py-2.5 pr-3 font-mono text-xs tabular-nums text-charcoal-soft">
                          {formatToken(row.token)}
                        </td>
                        <td className="py-2.5 pr-3 tabular-nums text-charcoal-soft">
                          {row.head_count}
                          {row.extra_pax ? (
                            <span className="block text-xs text-charcoal-soft">
                              {row.named_count} named + {row.extra_pax}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2.5">
                          {row.photo_status === "ready" ? (
                            <span className="flex items-center gap-2">
                              <a
                                href={`/api/qr/photo/${row.token}?v=${row.photo_version}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-xs font-semibold text-gold underline"
                              >
                                View
                              </a>
                              <button
                                type="button"
                                disabled={pending}
                                onClick={() =>
                                  startTransition(async () => {
                                    await deletePhotoAction(event.id, row.id);
                                    router.refresh();
                                  })
                                }
                                className="text-xs font-semibold text-rust underline"
                              >
                                Delete
                              </button>
                            </span>
                          ) : (
                            <span className="text-xs text-charcoal-soft">—</span>
                          )}
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
        </>
      ) : null}
    </>
  );
}
