"use client";

import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LAYOUTS,
  ORNAMENTS,
  MOTIONS,
  FONT_PAIRS,
  DEFAULT_THEME,
  sanitizeTheme,
  contrastRatio,
} from "@/lib/events/theme";
import { LANGS } from "@/lib/events/i18n";
import InvitationCard, { InvitationShell } from "@/components/events/InvitationCard";
import {
  generateThemeAction,
  generateArtAction,
  saveThemeDraftAction,
  approveThemeAction,
  discardThemeDraftAction,
} from "../../theme-actions";

/* The theme studio.

   THE INVARIANT: the preview on the right is <InvitationCard>, the exact
   component a guest's page renders. Not a mock, not a swatch board. Karim is
   approving something that goes to 200 people in one press, so "what I saw" and
   "what they get" have to be the same code.

   The working theme is held UNSANITIZED in state and passed through
   sanitizeTheme only for rendering. That distinction matters at the colour
   inputs: sanitize enforces 7:1 body contrast by darkening `ink`, so writing
   the sanitized value back into the field would yank the swatch out from under
   Karim mid-choice. Instead the field keeps what he picked and the panel tells
   him what the renderer actually did with it. */

const card = "rounded-card border border-line bg-white p-5 sm:p-6";
const label = "mb-1.5 block text-sm font-semibold text-ink";
const field =
  "w-full rounded-control border border-line bg-paper px-3 py-2.5 text-base text-ink outline-none focus:border-gold";
const btn =
  "rounded-pill bg-ink px-5 py-2.5 text-sm font-semibold text-white transition-[transform,opacity] duration-150 ease-out active:scale-[0.97] disabled:opacity-60";
const btnQuiet =
  "rounded-pill border border-line px-5 py-2.5 text-sm font-semibold text-ink transition-transform duration-150 ease-out active:scale-[0.97] disabled:opacity-60";

const PALETTE_FIELDS = [
  ["bg", "Page", "Behind the card"],
  ["surface", "Card", "Body text sits on this"],
  ["ink", "Body text", "Needs 7:1 on the card"],
  ["muted", "Secondary text", "Needs 4.5:1"],
  ["accent", "Accent", "Buttons, rules, ornament"],
  ["line", "Hairlines", "Borders"],
];

const LAYOUT_LABELS = {
  "centered-classic": "Centred classic",
  "framed-panel": "Framed panel",
  "photo-hero": "Photo hero",
  "side-band": "Side band",
  "arch-window": "Arch window",
  "minimal-rule": "Minimal rule",
};

function titleCase(value) {
  return value.replace(/-/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

function Notice({ tone = "warn", children }) {
  const tones = { warn: "bg-sand text-sage", bad: "bg-rust-soft text-rust", good: "bg-gold-soft text-ink" };
  return <p className={`rounded-control px-3 py-2 text-sm ${tones[tone]}`}>{children}</p>;
}

function Slider({ id, labelText, value, min, max, step, onChange, format }) {
  return (
    <div>
      <label className={label} htmlFor={id}>
        {labelText}{" "}
        <span className="font-normal tabular-nums text-charcoal-soft">
          {format ? format(value) : value}
        </span>
      </label>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="w-full accent-gold"
      />
    </div>
  );
}

export default function ThemeStudio({ event, sampleGuest, hasGemini }) {
  const router = useRouter();

  // Start from the draft if one is waiting, otherwise the live theme.
  const [theme, setTheme] = useState(event.themeDraft || event.theme || DEFAULT_THEME);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(null);
  const [flash, setFlash] = useState(null);
  const [rationale, setRationale] = useState(null);

  const [brief, setBrief] = useState("");
  const [artPrompt, setArtPrompt] = useState("");
  const [withArt, setWithArt] = useState(true);
  const [reference, setReference] = useState(null); // { dataUrl, name }
  const fileRef = useRef(null);

  const [lang, setLang] = useState("en");
  const [wide, setWide] = useState(false);

  // The single source of truth for the preview — and the only thing ever sent
  // to the server as a theme.
  const safe = useMemo(() => sanitizeTheme(theme), [theme]);

  function set(key, value) {
    setTheme((t) => ({ ...sanitizeTheme(t), [key]: value }));
    setDirty(true);
  }

  function setColor(key, value) {
    setTheme((t) => {
      const base = sanitizeTheme(t);
      return { ...base, palette: { ...base.palette, [key]: value } };
    });
    setDirty(true);
  }

  async function pickReference(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!/^image\/(jpeg|png|webp)$/.test(file.type)) {
      setFlash({ tone: "bad", text: "Reference must be a JPEG, PNG or WebP." });
      return;
    }
    const dataUrl = await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(file);
    });
    setReference({ dataUrl, name: file.name });
    setFlash(null);
  }

  async function generate() {
    setBusy("generate");
    setFlash(null);
    const res = await generateThemeAction(event.id, {
      imageDataUrl: reference?.dataUrl,
      brief,
      withArt,
    });
    setBusy(null);
    if (!res.ok) {
      setFlash({ tone: "bad", text: res.error });
      return;
    }
    setTheme(res.theme);
    setRationale(res.rationale);
    if (res.artPrompt) setArtPrompt(res.artPrompt);
    setDirty(false);
    setFlash(
      res.note
        ? { tone: "warn", text: res.note }
        : { tone: "good", text: "Design generated and saved as a draft." }
    );
    router.refresh();
  }

  async function regenerateArt() {
    setBusy("art");
    setFlash(null);
    const res = await generateArtAction(event.id, artPrompt, safe);
    setBusy(null);
    if (!res.ok) {
      setFlash({ tone: "bad", text: res.error });
      return;
    }
    setTheme(res.theme);
    setDirty(false);
    setFlash({ tone: "good", text: "New background art generated." });
    router.refresh();
  }

  async function saveDraft() {
    setBusy("save");
    const res = await saveThemeDraftAction(event.id, safe);
    setBusy(null);
    setDirty(false);
    setFlash({ tone: "good", text: "Draft saved. Guests still see the approved design." });
    if (res.theme) setTheme(res.theme);
    router.refresh();
  }

  async function approve() {
    setBusy("approve");
    const res = await approveThemeAction(event.id, safe);
    setBusy(null);
    if (!res.ok) {
      setFlash({ tone: "bad", text: res.error });
      return;
    }
    setDirty(false);
    setFlash({ tone: "good", text: "Approved — this is what guests see from now on." });
    router.refresh();
  }

  async function discard() {
    setBusy("discard");
    await discardThemeDraftAction(event.id);
    setBusy(null);
    setTheme(event.theme || DEFAULT_THEME);
    setRationale(null);
    setDirty(false);
    setFlash({ tone: "good", text: "Draft discarded." });
    router.refresh();
  }

  /* Contrast readout. sanitizeTheme has already fixed anything failing, so this
     reports what the renderer DID — the point is to show Karim when his pick
     was overridden, not to nag him about a ratio the page can never ship. */
  const contrast = PALETTE_FIELDS.filter(([key]) => key === "ink" || key === "muted" || key === "accent").map(
    ([key]) => ({
      key,
      chosen: (theme?.palette?.[key] || "").toUpperCase(),
      applied: safe.palette[key],
      ratio: contrastRatio(safe.palette[key], safe.palette.surface),
    })
  );
  const adjusted = contrast.filter((c) => /^#[0-9A-F]{6}$/.test(c.chosen) && c.chosen !== c.applied);

  return (
    <div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,460px)] lg:items-start">
      {/* ---- controls ---- */}
      <div className="grid gap-6">
        {flash ? <Notice tone={flash.tone}>{flash.text}</Notice> : null}

        <section className={card}>
          <h2 className="text-base font-semibold text-ink">Generate a design</h2>
          <p className="mt-1 text-sm text-charcoal-soft">
            Upload an invitation you like the look of. Gemini reads its character and returns an
            original design — it never copies the reference, and it never writes markup: it picks
            from the layouts and ornaments below, so a bad result can only ever be ugly, never
            broken.
          </p>

          {!hasGemini ? (
            <div className="mt-4">
              <Notice tone="bad">
                GEMINI_API_KEY isn&apos;t set on this server, so generation is off. The manual
                controls below still work.
              </Notice>
            </div>
          ) : null}

          <div className="mt-4 grid gap-4">
            <div>
              <span className={label}>Reference image (optional)</span>
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                onChange={pickReference}
                className="block w-full text-sm text-charcoal-soft file:mr-3 file:rounded-pill file:border-0 file:bg-ink file:px-4 file:py-2 file:text-sm file:font-semibold file:text-white"
              />
              {reference ? (
                <div className="mt-3 flex items-center gap-3">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={reference.dataUrl}
                    alt=""
                    className="h-16 w-16 rounded-control border border-line object-cover"
                  />
                  <span className="text-sm text-charcoal-soft">{reference.name}</span>
                  <button
                    type="button"
                    className="text-sm text-gold hover:underline"
                    onClick={() => {
                      setReference(null);
                      if (fileRef.current) fileRef.current.value = "";
                    }}
                  >
                    Remove
                  </button>
                </div>
              ) : null}
            </div>

            <div>
              <label className={label} htmlFor="brief">
                Brief (optional)
              </label>
              <textarea
                id="brief"
                rows={3}
                value={brief}
                onChange={(e) => setBrief(e.target.value)}
                placeholder="Warm and formal, deep green and gold, feels like a Maulid gathering."
                className={field}
              />
            </div>

            <label className="flex items-start gap-2.5 text-sm text-charcoal-soft">
              <input
                type="checkbox"
                checked={withArt}
                onChange={(e) => setWithArt(e.target.checked)}
                className="mt-0.5 h-4 w-4 accent-gold"
              />
              <span>
                Also generate background art if the design calls for it. Adds ~20 seconds and one
                image generation.
              </span>
            </label>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btn}
                disabled={!hasGemini || busy !== null}
                onClick={generate}
              >
                {busy === "generate" ? "Designing…" : "Generate design"}
              </button>
            </div>

            {rationale ? (
              <p className="rounded-control border border-line bg-paper px-4 py-3 text-sm italic text-charcoal-soft">
                {rationale}
              </p>
            ) : null}
          </div>
        </section>

        <section className={card}>
          <h2 className="text-base font-semibold text-ink">Structure</h2>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <label className={label} htmlFor="layout">
                Layout
              </label>
              <select
                id="layout"
                className={field}
                value={safe.layout}
                onChange={(e) => set("layout", e.target.value)}
              >
                {LAYOUTS.map((l) => (
                  <option key={l} value={l}>
                    {LAYOUT_LABELS[l] || titleCase(l)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={label} htmlFor="ornament">
                Ornament
              </label>
              <select
                id="ornament"
                className={field}
                value={safe.ornament}
                onChange={(e) => set("ornament", e.target.value)}
              >
                {ORNAMENTS.map((o) => (
                  <option key={o} value={o}>
                    {titleCase(o)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={label} htmlFor="fontPair">
                Typeface pairing
              </label>
              <select
                id="fontPair"
                className={field}
                value={safe.fontPair}
                onChange={(e) => set("fontPair", e.target.value)}
              >
                {Object.keys(FONT_PAIRS).map((f) => (
                  <option key={f} value={f}>
                    {titleCase(f)}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <label className={label} htmlFor="motion">
                Entrance
              </label>
              <select
                id="motion"
                className={field}
                value={safe.motion}
                onChange={(e) => set("motion", e.target.value)}
              >
                {MOTIONS.map((m) => (
                  <option key={m} value={m}>
                    {titleCase(m)}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="mt-5 grid gap-5 sm:grid-cols-2">
            <Slider
              id="scale"
              labelText="Type size"
              value={safe.scale}
              min={0.85}
              max={1.25}
              step={0.05}
              onChange={(v) => set("scale", v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              id="radius"
              labelText="Corner rounding"
              value={safe.radius}
              min={0}
              max={32}
              step={1}
              onChange={(v) => set("radius", v)}
              format={(v) => `${v}px`}
            />
            <Slider
              id="ornamentOpacity"
              labelText="Ornament strength"
              value={safe.ornamentOpacity}
              min={0}
              max={0.4}
              step={0.01}
              onChange={(v) => set("ornamentOpacity", v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
            <Slider
              id="bgImageOpacity"
              labelText="Background art strength"
              value={safe.bgImageOpacity}
              min={0}
              max={0.6}
              step={0.01}
              onChange={(v) => set("bgImageOpacity", v)}
              format={(v) => `${Math.round(v * 100)}%`}
            />
          </div>
        </section>

        <section className={card}>
          <h2 className="text-base font-semibold text-ink">Colours</h2>
          <div className="mt-4 grid gap-3 sm:grid-cols-2">
            {PALETTE_FIELDS.map(([key, name, hint]) => (
              <div key={key} className="flex items-center gap-3">
                {/* Bound to the CHOSEN colour, not the sanitized one. Binding
                    it to `safe` would make the swatch jump away from the pick
                    whenever contrast enforcement darkened it — the panel below
                    reports that instead. */}
                <input
                  type="color"
                  aria-label={name}
                  value={theme?.palette?.[key] || safe.palette[key]}
                  onChange={(e) => setColor(key, e.target.value)}
                  className="h-10 w-12 flex-none cursor-pointer rounded-control border border-line bg-white"
                />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-ink">{name}</p>
                  <p className="truncate text-xs text-charcoal-soft">{hint}</p>
                </div>
              </div>
            ))}
          </div>

          <dl className="mt-5 grid gap-1.5 rounded-control border border-line bg-paper px-4 py-3 text-sm">
            {contrast.map((c) => (
              <div key={c.key} className="flex items-baseline justify-between gap-3">
                <dt className="text-charcoal-soft">{titleCase(c.key)} on card</dt>
                <dd className="tabular-nums text-ink">{c.ratio.toFixed(1)}:1</dd>
              </div>
            ))}
          </dl>

          {adjusted.length ? (
            <p className="mt-3 text-sm text-charcoal-soft">
              Darkened for legibility:{" "}
              {adjusted.map((c) => `${c.key} ${c.chosen} → ${c.applied}`).join(", ")}. Body text is
              held at 7:1 and everything else at 4.5:1, so a guest reading on a phone in sunlight
              can still read it.
            </p>
          ) : null}
        </section>

        <section className={card}>
          <h2 className="text-base font-semibold text-ink">Background art</h2>
          <p className="mt-1 text-sm text-charcoal-soft">
            Abstract only — no text, no people or animals. Stored on the server and served from
            this domain, never inlined into the invitation.
          </p>
          <div className="mt-4 grid gap-3">
            <textarea
              rows={2}
              value={artPrompt}
              onChange={(e) => setArtPrompt(e.target.value)}
              placeholder="Soft cream paper with faint gold geometric tessellation, very pale."
              className={field}
            />
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className={btnQuiet}
                disabled={!hasGemini || busy !== null}
                onClick={regenerateArt}
              >
                {busy === "art" ? "Drawing…" : safe.bgImage ? "Replace art" : "Generate art"}
              </button>
              {safe.bgImage ? (
                <button type="button" className={btnQuiet} onClick={() => set("bgImage", null)}>
                  Remove art
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className={card}>
          <h2 className="text-base font-semibold text-ink">Publish</h2>
          <p className="mt-1 text-sm text-charcoal-soft">
            {event.themeDraft
              ? "There's a draft waiting. Guests still see the approved design until you approve this one."
              : "Guests are seeing the approved design. Changes here become a draft until approved."}
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="button" className={btnQuiet} disabled={busy !== null} onClick={saveDraft}>
              {busy === "save" ? "Saving…" : "Save draft"}
            </button>
            <button type="button" className={btn} disabled={busy !== null} onClick={approve}>
              {busy === "approve" ? "Approving…" : "Approve for guests"}
            </button>
            {event.themeDraft ? (
              <button type="button" className={btnQuiet} disabled={busy !== null} onClick={discard}>
                Discard draft
              </button>
            ) : null}
          </div>
          {dirty ? (
            <p className="mt-3 text-sm text-charcoal-soft">
              Unsaved changes — approving saves them first.
            </p>
          ) : null}
        </section>
      </div>

      {/* ---- preview ---- */}
      <div className="lg:sticky lg:top-6">
        <div className="flex flex-wrap items-center gap-2">
          {LANGS.map((l) => (
            <button
              key={l.code}
              type="button"
              onClick={() => setLang(l.code)}
              aria-current={lang === l.code}
              className={`rounded-pill px-3.5 py-1.5 text-sm transition-colors ${
                lang === l.code ? "bg-ink text-white" : "border border-line text-charcoal-soft"
              }`}
            >
              {l.label}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setWide((w) => !w)}
            className="rounded-pill border border-line px-3.5 py-1.5 text-sm text-charcoal-soft"
          >
            {wide ? "Phone" : "Desktop"}
          </button>
        </div>

        <p className="mt-2 text-xs text-charcoal-soft">
          This is the guest page&apos;s own renderer, not a mock. Arabic flips the whole layout —
          check it before you approve.
        </p>

        <div
          className="mt-3 overflow-hidden rounded-card border border-line bg-white shadow-sm"
          style={{ maxWidth: wide ? "100%" : 390, marginInline: wide ? undefined : "auto" }}
        >
          {/* Keyed on layout+motion so switching either remounts the card and
              replays the entrance — otherwise picking "reveal" changes nothing
              visible and reads as a broken control. */}
          <InvitationShell
            key={`${safe.layout}-${safe.motion}`}
            theme={safe}
            lang={lang}
            preview
          >
            <InvitationCard event={event} guest={sampleGuest} theme={safe} lang={lang}>
              <div className="inv-actions">
                <span className="inv-btn inv-btn-quiet">
                  {lang === "ar" ? "أضف إلى التقويم" : lang === "ms" ? "Tambah ke kalendar" : "Add to calendar"}
                </span>
              </div>
            </InvitationCard>

            <div className="inv-card inv-rise">
              <h2 className="inv-section-title">
                {lang === "ar" ? "هل ستحضر؟" : lang === "ms" ? "Boleh hadir?" : "Will you join us?"}
              </h2>
              <p className="inv-note">
                {lang === "ar"
                  ? "نموذج الرد يظهر هنا."
                  : lang === "ms"
                    ? "Borang RSVP dipaparkan di sini."
                    : "The RSVP form appears here."}
              </p>
              <div className="inv-choices">
                <span className="inv-choice">
                  <span>{lang === "ar" ? "نعم" : "Yes"}</span>
                </span>
                <span className="inv-choice">
                  <span>{lang === "ar" ? "ربما" : "Maybe"}</span>
                </span>
                <span className="inv-choice">
                  <span>{lang === "ar" ? "لا" : "No"}</span>
                </span>
              </div>
              <span className="inv-btn">{lang === "ar" ? "إرسال" : "Send reply"}</span>
            </div>

            <p className="inv-footer">Little Quran Kids</p>
          </InvitationShell>
        </div>
      </div>
    </div>
  );
}
