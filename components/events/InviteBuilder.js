"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import Icon from "@/components/Icon";
import InviteCard from "./InviteCard";
import SendPanel from "./SendPanel";
import { saveEvent, uploadEventAsset, clearEventAsset } from "@/lib/actions/events";
import { FONTS, ALIGNMENTS, LANGUAGES, OVERLAY_MIN, OVERLAY_MAX, t } from "@/lib/events/design";

// ── Small form primitives ──────────────────────────────────────────────────

function Field({ label, hint, children, htmlFor }) {
  return (
    <div>
      <label htmlFor={htmlFor} className="text-[12px] font-bold text-charcoal-soft">
        {label}
      </label>
      <div className="mt-1">{children}</div>
      {hint ? <p className="mt-1 text-[11px] text-charcoal-soft">{hint}</p> : null}
    </div>
  );
}

const inputClass =
  "w-full rounded-control border border-line bg-paper px-3 py-2.5 text-[14px] text-charcoal outline-none focus:border-gold";

function Text({ id, value, onChange, placeholder, type = "text" }) {
  return (
    <input id={id} type={type} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={inputClass} />
  );
}

function Area({ id, value, onChange, placeholder, rows = 3 }) {
  return (
    <textarea id={id} rows={rows} value={value || ""} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className={`${inputClass} resize-y`} />
  );
}

function Section({ title, children, defaultOpen = true }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="rounded-card border border-line bg-white">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-4 py-3.5 text-left"
      >
        <span className="font-heading text-[15px] font-semibold text-charcoal">{title}</span>
        <span className={`transition-transform ${open ? "rotate-180" : ""}`}>
          <Icon name="chevron-down" size={16} />
        </span>
      </button>
      {open ? <div className="space-y-4 border-t border-line px-4 py-4">{children}</div> : null}
    </section>
  );
}

function Swatch({ label, value, onChange }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-[12px] text-charcoal">{label}</span>
      <span className="flex items-center gap-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={`${label} hex value`}
          className="w-[86px] rounded-control border border-line bg-paper px-2 py-1 font-mono text-[12px] outline-none focus:border-gold"
        />
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          aria-label={label}
          className="h-8 w-8 cursor-pointer rounded-control border border-line bg-white p-0.5"
        />
      </span>
    </div>
  );
}

// ── Builder ────────────────────────────────────────────────────────────────

const SAVE_DEBOUNCE_MS = 900;

export default function InviteBuilder({ initialEvent, initialRecipients, initialCounts, initialJob, lists, channels }) {
  const [event, setEvent] = useState(initialEvent);
  const [recipients, setRecipients] = useState(initialRecipients);
  const [saveState, setSaveState] = useState("saved"); // saved | saving | error
  const [uploadError, setUploadError] = useState("");

  const sent = event.status === "sent";

  // Debounced autosave. `dirty` is a ref so a keystroke doesn't restart the
  // effect on every render — only the timer matters.
  const timer = useRef(null);
  const pending = useRef(null);

  const flush = useCallback(async () => {
    const patch = pending.current;
    if (!patch) return;
    pending.current = null;
    setSaveState("saving");
    const result = await saveEvent(initialEvent.id, patch);
    if (result?.error) setSaveState("error");
    else setSaveState("saved");
  }, [initialEvent.id]);

  const queue = useCallback(
    (patch) => {
      pending.current = { ...(pending.current || {}), ...patch };
      setSaveState("saving");
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DEBOUNCE_MS);
    },
    [flush]
  );

  // Don't lose the last keystrokes if the tab closes mid-debounce.
  useEffect(() => {
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  function setField(key, value) {
    setEvent((e) => ({ ...e, [key]: value }));
    queue({ [key]: value });
  }

  function setDesign(key, value) {
    setEvent((e) => {
      const design = { ...e.design, [key]: value };
      queue({ design });
      return { ...e, design };
    });
  }

  function setAgenda(next) {
    setEvent((e) => ({ ...e, agenda: next }));
    queue({ agenda: next });
  }

  async function onUpload(kind, file) {
    if (!file) return;
    setUploadError("");
    const fd = new FormData();
    fd.set("eventId", event.id);
    fd.set("kind", kind);
    fd.set("file", file);
    const result = await uploadEventAsset(fd);
    if (result?.error) setUploadError(result.error);
    else if (result?.event) setEvent((e) => ({ ...e, ...result.event }));
  }

  async function onClearAsset(kind) {
    const result = await clearEventAsset(event.id, kind);
    if (result?.event) setEvent((e) => ({ ...e, ...result.event }));
  }

  return (
    <div className="mx-auto max-w-[1400px] px-5 py-7 lg:px-8">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/events" aria-label="Back to invites" className="rounded-control p-2 text-charcoal-soft hover:bg-paper-deep">
            <Icon name="arrow-left" size={18} />
          </Link>
          <div className="min-w-0">
            <h1 className="truncate font-heading text-xl font-semibold text-charcoal">{event.title || "Untitled event"}</h1>
            <p className="text-[12px] text-charcoal-soft">
              {sent ? "Sent" : "Draft"} ·{" "}
              {saveState === "saving" ? "Saving…" : saveState === "error" ? "Couldn't save — check your connection" : "All changes saved"}
            </p>
          </div>
        </div>
        <a
          href={`/invite/${event.slug}`}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-white px-4 py-2 text-[13px] font-bold text-charcoal hover:bg-paper-deep"
        >
          <Icon name="globe" size={15} />
          Open live page
        </a>
      </div>

      {sent ? (
        <div className="mt-4 rounded-card border border-[#DCD3F0] bg-[#F3EFFA] p-3.5">
          <p className="text-[13px] text-[#4A3D63]">
            This invite has been sent. Edits still show on the live page parents visit, but the emails already in their
            inboxes won&apos;t change.
          </p>
        </div>
      ) : null}

      <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,520px)]">
        {/* ── Left: the form ─────────────────────────────────────────── */}
        <div className="space-y-3.5">
          <Section title="The basics">
            <Field label="Event name" htmlFor="f-title">
              <Text id="f-title" value={event.title} onChange={(v) => setField("title", v)} placeholder="Graduation Day 2026" />
            </Field>
            <Field label="Tagline" htmlFor="f-tagline" hint="One line under the title.">
              <Text id="f-tagline" value={event.tagline} onChange={(v) => setField("tagline", v)} placeholder="A morning of celebration with our huffaz" />
            </Field>
            <Field label="Message to parents" htmlFor="f-body">
              <Area id="f-body" value={event.body} onChange={(v) => setField("body", v)} rows={4} placeholder="We would be honoured to have you join us as we celebrate…" />
            </Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Starts" htmlFor="f-starts">
                <Text id="f-starts" type="datetime-local" value={event.startsAt} onChange={(v) => setField("startsAt", v)} />
              </Field>
              <Field label="Ends" htmlFor="f-ends">
                <Text id="f-ends" type="datetime-local" value={event.endsAt} onChange={(v) => setField("endsAt", v)} />
              </Field>
            </div>
            <Field label="Language" htmlFor="f-lang" hint="Changes the fixed wording — 'You're invited', the RSVP buttons and so on.">
              <select id="f-lang" value={event.language} onChange={(e) => setField("language", e.target.value)} className={inputClass}>
                {LANGUAGES.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.label}
                  </option>
                ))}
              </select>
            </Field>
          </Section>

          <Section title="Where it is">
            <Field label="Venue name" htmlFor="f-venue">
              <Text id="f-venue" value={event.venueName} onChange={(v) => setField("venueName", v)} placeholder="LQK Woods Square" />
            </Field>
            <Field label="Address" htmlFor="f-address">
              <Area id="f-address" rows={2} value={event.venueAddress} onChange={(v) => setField("venueAddress", v)} placeholder="12 Woodlands Square, #05-1, Singapore 737715" />
            </Field>
            <Field label="Google Maps link" htmlFor="f-map" hint="Becomes an 'Open in Maps' button. Must start with http:// or https://.">
              <Text id="f-map" value={event.mapUrl} onChange={(v) => setField("mapUrl", v)} placeholder="https://maps.app.goo.gl/…" />
            </Field>
            <Field label="Directions" htmlFor="f-directions">
              <Area id="f-directions" rows={2} value={event.directions} onChange={(v) => setField("directions", v)} placeholder="Take the lift lobby B to level 5, turn right." />
            </Field>
            <Field label="Parking" htmlFor="f-parking">
              <Area id="f-parking" rows={2} value={event.parking} onChange={(v) => setField("parking", v)} placeholder="Free parking in the basement, enter from Woodlands Ave 2." />
            </Field>
          </Section>

          <Section title="Programme" defaultOpen={false}>
            <AgendaEditor agenda={event.agenda} onChange={setAgenda} />
            <Field label="Dress code" htmlFor="f-dress">
              <Text id="f-dress" value={event.dressCode} onChange={(v) => setField("dressCode", v)} placeholder="Smart casual, modest attire" />
            </Field>
            <Field label="What to bring" htmlFor="f-bring">
              <Area id="f-bring" rows={2} value={event.bring} onChange={(v) => setField("bring", v)} placeholder="Just yourselves — refreshments provided." />
            </Field>
          </Section>

          <Section title="Images" defaultOpen={false}>
            <AssetField
              label="Event logo"
              hint="Shown above the title. PNG with a transparent background works best. Max 2 MB."
              path={event.logoPath}
              onUpload={(file) => onUpload("logo", file)}
              onClear={() => onClearAsset("logo")}
              accept="image/png,image/jpeg,image/webp,image/svg+xml"
            />
            <AssetField
              label="Background image"
              hint="Sits behind the title. A wide photo works best. Max 6 MB."
              path={event.backgroundPath}
              onUpload={(file) => onUpload("background", file)}
              onClear={() => onClearAsset("background")}
              accept="image/png,image/jpeg,image/webp"
            />
            {uploadError ? <p className="text-[12px] text-rust">{uploadError}</p> : null}
          </Section>

          <Section title="Design" defaultOpen={false}>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Heading font" htmlFor="f-hfont">
                <select id="f-hfont" value={event.design.headingFont} onChange={(e) => setDesign("headingFont", e.target.value)} className={inputClass}>
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Body font" htmlFor="f-bfont">
                <select id="f-bfont" value={event.design.bodyFont} onChange={(e) => setDesign("bodyFont", e.target.value)} className={inputClass}>
                  {FONTS.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.label}
                    </option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Alignment">
              <div className="flex gap-1.5">
                {ALIGNMENTS.map((a) => (
                  <button
                    key={a}
                    type="button"
                    onClick={() => setDesign("align", a)}
                    aria-pressed={event.design.align === a}
                    className={`flex-1 rounded-control px-3 py-2 text-[13px] font-bold capitalize transition ${
                      event.design.align === a ? "bg-ink text-white" : "border border-line bg-paper text-charcoal hover:bg-paper-deep"
                    }`}
                  >
                    {a}
                  </button>
                ))}
              </div>
            </Field>

            <div className="space-y-2.5">
              <Swatch label="Page background" value={event.design.pageColor} onChange={(v) => setDesign("pageColor", v)} />
              <Swatch label="Card background" value={event.design.cardColor} onChange={(v) => setDesign("cardColor", v)} />
              <Swatch label="Text" value={event.design.textColor} onChange={(v) => setDesign("textColor", v)} />
              <Swatch label="Muted text / labels" value={event.design.mutedColor} onChange={(v) => setDesign("mutedColor", v)} />
              <Swatch label="Accent / buttons" value={event.design.accentColor} onChange={(v) => setDesign("accentColor", v)} />
              <Swatch label="Button text" value={event.design.buttonTextColor} onChange={(v) => setDesign("buttonTextColor", v)} />
            </div>

            <Field
              label={`Background dimming — ${event.design.overlay}%`}
              htmlFor="f-overlay"
              hint="How much the background photo is darkened so the title stays readable."
            >
              <input
                id="f-overlay"
                type="range"
                min={OVERLAY_MIN}
                max={OVERLAY_MAX}
                value={event.design.overlay}
                onChange={(e) => setDesign("overlay", Number(e.target.value))}
                className="w-full accent-gold"
              />
            </Field>

            <Field label={`Corner rounding — ${event.design.cornerRadius}px`} htmlFor="f-radius">
              <input
                id="f-radius"
                type="range"
                min={0}
                max={40}
                value={event.design.cornerRadius}
                onChange={(e) => setDesign("cornerRadius", Number(e.target.value))}
                className="w-full accent-gold"
              />
            </Field>

            <label className="flex items-center gap-2 text-[13px] text-charcoal">
              <input type="checkbox" checked={event.design.showLogo} onChange={(e) => setDesign("showLogo", e.target.checked)} className="accent-gold" />
              Show the logo on the invite
            </label>
          </Section>

          <Section title="Sign-off" defaultOpen={false}>
            <Field label="Hosted by" htmlFor="f-host">
              <Text id="f-host" value={event.hostName} onChange={(v) => setField("hostName", v)} placeholder="Little Quran Kids" />
            </Field>
            <Field label="Contact line" htmlFor="f-contact" hint="Shown at the foot of the invite.">
              <Text id="f-contact" value={event.contactLine} onChange={(v) => setField("contactLine", v)} placeholder="Questions? WhatsApp us on 8123 4567" />
            </Field>
          </Section>

          <SendPanel
            event={event}
            recipients={recipients}
            setRecipients={setRecipients}
            counts={initialCounts}
            initialJob={initialJob}
            lists={lists}
            channels={channels}
            onBeforeSend={flush}
          />
        </div>

        {/* ── Right: live preview ────────────────────────────────────── */}
        <div className="lg:sticky lg:top-6 lg:self-start">
          <p className="mb-2 text-[12px] font-bold text-charcoal-soft">
            Live preview — this is the page parents will open
          </p>
          <div className="overflow-hidden rounded-card border border-line" style={{ background: event.design.pageColor }}>
            <div className="p-4">
              <InviteCard event={event}>
                {/* A dead stand-in for the real RSVP panel: same wording and
                    same colours, but nothing to press in a preview. */}
                <div className="border-t px-8 py-6 text-center" style={{ borderColor: `${event.design.mutedColor}22` }}>
                  <p className="text-[15px] font-bold">{t(event.language).willYouCome}</p>
                  <div className="mt-3 flex flex-wrap justify-center gap-2">
                    <span
                      className="rounded-full px-5 py-2.5 text-[14px] font-bold"
                      style={{ background: event.design.accentColor, color: event.design.buttonTextColor }}
                    >
                      {t(event.language).yes}
                    </span>
                    <span
                      className="rounded-full px-5 py-2.5 text-[14px] font-bold"
                      style={{ color: event.design.mutedColor, boxShadow: `inset 0 0 0 1.5px ${event.design.mutedColor}55` }}
                    >
                      {t(event.language).no}
                    </span>
                  </div>
                </div>
              </InviteCard>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Agenda ─────────────────────────────────────────────────────────────────

function AgendaEditor({ agenda, onChange }) {
  const rows = agenda || [];

  function update(i, key, value) {
    const next = rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r));
    onChange(next);
  }

  return (
    <div>
      <p className="text-[12px] font-bold text-charcoal-soft">Schedule</p>
      <div className="mt-1.5 space-y-2">
        {rows.map((row, i) => (
          <div key={i} className="flex gap-2">
            <input
              value={row.time}
              onChange={(e) => update(i, "time", e.target.value)}
              placeholder="09:00"
              aria-label={`Time for item ${i + 1}`}
              className="w-[92px] flex-shrink-0 rounded-control border border-line bg-paper px-2.5 py-2 text-[13px] outline-none focus:border-gold"
            />
            <input
              value={row.activity}
              onChange={(e) => update(i, "activity", e.target.value)}
              placeholder="Arrival & refreshments"
              aria-label={`Activity for item ${i + 1}`}
              className="min-w-0 flex-1 rounded-control border border-line bg-paper px-2.5 py-2 text-[13px] outline-none focus:border-gold"
            />
            <button
              type="button"
              onClick={() => onChange(rows.filter((_, idx) => idx !== i))}
              aria-label={`Remove item ${i + 1}`}
              className="flex-shrink-0 rounded-control p-2 text-charcoal-soft hover:bg-rust-soft hover:text-rust"
            >
              <Icon name="trash" size={14} />
            </button>
          </div>
        ))}
      </div>
      <button
        type="button"
        onClick={() => onChange([...rows, { time: "", activity: "" }])}
        className="mt-2 inline-flex items-center gap-1.5 rounded-control border border-line px-3 py-1.5 text-[12px] font-bold text-charcoal hover:bg-paper-deep"
      >
        <Icon name="plus" size={14} />
        Add a line
      </button>
    </div>
  );
}

// ── Image upload ───────────────────────────────────────────────────────────

function AssetField({ label, hint, path, onUpload, onClear, accept }) {
  const [busy, setBusy] = useState(false);

  async function onChange(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    setBusy(true);
    await onUpload(file);
    setBusy(false);
    e.target.value = "";
  }

  return (
    <div>
      <p className="text-[12px] font-bold text-charcoal-soft">{label}</p>
      <div className="mt-1.5 flex items-center gap-3">
        {path ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={`/api/events/asset/${path}`}
            alt=""
            className="h-16 w-16 flex-shrink-0 rounded-control border border-line bg-paper object-contain"
          />
        ) : (
          <span className="flex h-16 w-16 flex-shrink-0 items-center justify-center rounded-control border border-dashed border-line bg-paper text-charcoal-soft">
            <Icon name="image" size={18} />
          </span>
        )}
        <div className="flex flex-wrap gap-2">
          <label className="cursor-pointer rounded-control border border-line bg-white px-3 py-1.5 text-[12px] font-bold text-charcoal hover:bg-paper-deep">
            {busy ? "Uploading…" : path ? "Replace" : "Upload"}
            <input type="file" accept={accept} onChange={onChange} className="hidden" disabled={busy} />
          </label>
          {path ? (
            <button
              type="button"
              onClick={onClear}
              className="rounded-control border border-line px-3 py-1.5 text-[12px] font-bold text-charcoal-soft hover:bg-rust-soft hover:text-rust"
            >
              Remove
            </button>
          ) : null}
        </div>
      </div>
      {hint ? <p className="mt-1 text-[11px] text-charcoal-soft">{hint}</p> : null}
    </div>
  );
}
