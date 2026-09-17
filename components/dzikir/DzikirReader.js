"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

// A horizontal drag moves to the neighbouring sub-section when it is decisively
// sideways: far enough to be deliberate, and clearly more horizontal than
// vertical so that scrolling a long litany never navigates by accident.
const SWIPE_MIN_PX = 64;
const SWIPE_RATIO = 1.6;
const SWIPE_MAX_MS = 900;

const LANGS = [
  { key: "en", label: "English" },
  { key: "id", label: "Bahasa" },
];

// One consistent Arabic stack for every passage. Noto Naskh Arabic is loaded by
// the reader page (lib/dzikir/font.js) and exposed as --font-dzikir-arabic;
// Amiri and the generic serif are only ever fallbacks for a missing glyph.
const ARABIC_STACK =
  "var(--font-dzikir-arabic), 'Noto Naskh Arabic', var(--font-amiri), 'Amiri', 'Scheherazade New', serif";

// Text size, matched to the Quran reader: a slider per layer in px rather than
// one coupled A−/A+ scale, over the same ranges (lib/quran/store.js), so a
// teacher who has tuned one reader finds the other set up the same way.
const SIZE_RANGE = {
  ar: { label: "Arabic", min: 20, max: 60 },
  tr: { label: "Transliteration", min: 10, max: 26 },
  mn: { label: "Meaning", min: 11, max: 26 },
};
const DEFAULT_SIZES = { ar: 30, tr: 15, mn: 15 };

// Arabic needs more leading as it grows: harakat and the naskh descenders
// collide at a fixed multiple. Stepped rather than continuous so the line grid
// stays steady while the slider is being dragged.
function arabicLineHeight(px) {
  if (px >= 44) return 2.15;
  if (px >= 36) return 2.1;
  if (px >= 30) return 2.05;
  return 2.0;
}

const SPEED_MIN = 1;
const SPEED_MAX = 5;
const DEFAULT_SPEED = 2;

const PREF_KEY = "lqk.dzikir.prefs";

// The A−/A+ steps this reader used before the sliders. Prefs already on a
// teacher's device carry the step index, so map it forward once rather than
// dropping them back to the default size.
const LEGACY_STEPS = [
  { ar: 22, tr: 12.5, mn: 13 },
  { ar: 26, tr: 13.5, mn: 14 },
  { ar: 30, tr: 14.5, mn: 15 },
  { ar: 36, tr: 15.5, mn: 16 },
  { ar: 44, tr: 17, mn: 18 },
];

function clampSize(key, value) {
  const cfg = SIZE_RANGE[key];
  if (!Number.isFinite(value)) return DEFAULT_SIZES[key];
  return Math.min(cfg.max, Math.max(cfg.min, Math.round(value)));
}

/**
 * The devotional reader: the WHOLE sub-section on one scrolling page.
 *
 * Every passage in the sub-section is laid out top to bottom, so a litany is
 * read straight through the way it is recited. Horizontal paging is reserved
 * for the level above — swipe, ← →, or the buttons at the foot cross into the
 * neighbouring sub-section — which keeps the nested trail (group → collection →
 * sub-section) intact while removing the page turn per verse.
 *
 * Reading aids: per-layer text-size sliders in a display sheet (the Quran
 * reader's control), transliteration/meaning toggles, an English⇄Bahasa picker,
 * and a hands-free auto-scroll for the long collections.
 */
export default function DzikirReader({ pages, title, prev = null, next = null, upHref = null }) {
  const router = useRouter();
  const [lang, setLang] = useState("en");
  const [showTranslit, setShowTranslit] = useState(true);
  const [showMeaning, setShowMeaning] = useState(true);
  const [sizes, setSizes] = useState(DEFAULT_SIZES);
  const [sizeOpen, setSizeOpen] = useState(false);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [loaded, setLoaded] = useState(false);

  // Restore preferences once, client-side, so SSR markup stays stable.
  //
  // eslint's set-state-in-effect rule fires here and is wrong about this one.
  // localStorage does not exist on the server, so these values CANNOT be read
  // while rendering or in a useState initialiser without producing markup the
  // server could not have produced — a hydration mismatch, which is a worse bug
  // than one extra render. Reading an external store the first time the
  // component reaches a browser is the case the rule's own documentation
  // describes as legitimate. The effect runs once, with an empty dependency
  // list, and cascades nothing.
  /* eslint-disable react-hooks/set-state-in-effect -- see the note above */
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      if (p.lang === "en" || p.lang === "id") setLang(p.lang);
      if (typeof p.showTranslit === "boolean") setShowTranslit(p.showTranslit);
      if (typeof p.showMeaning === "boolean") setShowMeaning(p.showMeaning);
      if (Number.isInteger(p.speed) && p.speed >= SPEED_MIN && p.speed <= SPEED_MAX) setSpeed(p.speed);

      const legacy = Number.isInteger(p.size) ? LEGACY_STEPS[p.size] : null;
      const stored = p.sizes && typeof p.sizes === "object" ? p.sizes : legacy;
      if (stored) {
        setSizes({
          ar: clampSize("ar", Number(stored.ar)),
          tr: clampSize("tr", Number(stored.tr)),
          mn: clampSize("mn", Number(stored.mn)),
        });
      }
    } catch {}
    setLoaded(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(
        PREF_KEY,
        JSON.stringify({ lang, showTranslit, showMeaning, sizes, speed })
      );
    } catch {}
  }, [loaded, lang, showTranslit, showMeaning, sizes, speed]);

  const setSize = useCallback((key, value) => {
    setSizes((s) => ({ ...s, [key]: clampSize(key, value) }));
  }, []);
  const resetSizes = useCallback(() => setSizes(DEFAULT_SIZES), []);

  // Hands-free auto-scroll of the window. Accumulate in a float because
  // scrollTop is integer-quantised and slow speeds would otherwise stall.
  useEffect(() => {
    if (!scrolling) return;
    const el = document.scrollingElement || document.documentElement;
    const pxPerSec = 12 + speed * 12; // ~24–72 px/s
    let raf = 0;
    let last = null;
    let acc = el.scrollTop;
    const tick = (t) => {
      if (last != null) {
        const dt = t - last;
        // Ignore long gaps (tab hidden — rAF pauses there) so refocusing never
        // causes a sudden jump; just resync to where the page actually is.
        if (dt > 0 && dt < 200) {
          acc += (pxPerSec * dt) / 1000;
          el.scrollTop = acc;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
            setScrolling(false); // reached the end
            return;
          }
        } else {
          acc = el.scrollTop;
        }
      }
      last = t;
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);

    // Yield to the reader: any manual scroll intent stops the auto-scroll.
    const stop = () => setScrolling(false);
    window.addEventListener("wheel", stop, { passive: true });
    window.addEventListener("touchstart", stop, { passive: true });
    window.addEventListener("keydown", onScrollKey);
    function onScrollKey(e) {
      if (["ArrowUp", "ArrowDown", "PageUp", "PageDown", " ", "Home", "End"].includes(e.key)) stop();
    }
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("wheel", stop);
      window.removeEventListener("touchstart", stop);
      window.removeEventListener("keydown", onScrollKey);
    };
  }, [scrolling, speed]);

  const total = pages.length;

  // ── Crossing sub-sections ─────────────────────────────────────────────────
  // Verses are scrolled, not paged, so a sideways move always means the
  // neighbouring sub-section — a real navigation, hence the router.
  const cross = useCallback(
    (delta) => {
      setScrolling(false); // never carry auto-scroll across a navigation
      const target = delta > 0 ? next : prev;
      if (target) router.push(target.href);
    },
    [prev, next, router]
  );

  // Arrow keys cross on desktop. Ignored while typing in a field, and never
  // when a modifier is held (that is a browser shortcut, e.g. ⌘← for Back).
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "ArrowRight") cross(1);
      else if (e.key === "ArrowLeft") cross(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [cross]);

  // Touch. Recorded on the container rather than the window so a swipe that
  // starts on the sticky control bar doesn't navigate.
  const touch = useRef(null);

  const onTouchStart = useCallback((e) => {
    if (e.touches.length !== 1) return; // ignore pinch-zoom
    const t = e.touches[0];
    touch.current = { x: t.clientX, y: t.clientY, at: Date.now() };
  }, []);

  const onTouchEnd = useCallback(
    (e) => {
      const start = touch.current;
      touch.current = null;
      if (!start) return;
      // A text selection drag is not a navigation.
      if (window.getSelection?.()?.toString()) return;

      const t = e.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Date.now() - start.at > SWIPE_MAX_MS) return;
      if (Math.abs(dx) < SWIPE_MIN_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

      cross(dx < 0 ? 1 : -1); // drag left → next section, drag right → previous
    },
    [cross]
  );

  const meaningOf = (p) => (p ? (lang === "en" ? p.en : p.id_) : "");

  if (!total) {
    return (
      <p className="rounded-card border border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        This section has no passages.
      </p>
    );
  }

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Controls, pinned so they stay reachable partway down a long litany. The
          negative margins bleed the bar to the page edges and must track the
          page's own padding (px-4 on phones, p-8 from sm up). */}
      <div className="sticky top-0 z-10 -mx-4 mb-5 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented value={lang} onChange={setLang} options={LANGS} />
          <Toggle label="Transliteration" on={showTranslit} onClick={() => setShowTranslit((v) => !v)} />
          <Toggle label="Meaning" on={showMeaning} onClick={() => setShowMeaning((v) => !v)} />

          {/* Text size — the Quran reader's sheet, sliders and all */}
          <button
            type="button"
            onClick={() => setSizeOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-pill border border-line bg-white px-2.5 py-1 text-[12px] font-semibold text-charcoal-soft transition-colors hover:text-charcoal"
          >
            <Icon name="type" size={13} />
            Text size
          </button>

          {/* Auto-scroll */}
          <div className="inline-flex items-center overflow-hidden rounded-pill border border-line bg-white">
            <button
              type="button"
              onClick={() => setScrolling((v) => !v)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-[12px] font-semibold transition-colors ${
                scrolling ? "bg-ink text-paper" : "text-charcoal-soft hover:text-charcoal"
              }`}
            >
              {scrolling ? <PauseGlyph /> : <PlayGlyph />}
              {scrolling ? "Scrolling" : "Auto-scroll"}
            </button>
            <StepBtn
              label="Slower"
              onClick={() => setSpeed((s) => Math.max(SPEED_MIN, s - 1))}
              disabled={speed === SPEED_MIN}
            >
              <span className="text-[13px] font-bold leading-none">−</span>
            </StepBtn>
            <span className="px-1 text-[11px] tabular-nums text-charcoal-soft/70" title="Scroll speed">
              {speed}
            </span>
            <StepBtn
              label="Faster"
              onClick={() => setSpeed((s) => Math.min(SPEED_MAX, s + 1))}
              disabled={speed === SPEED_MAX}
            >
              <span className="text-[13px] font-bold leading-none">+</span>
            </StepBtn>
          </div>

          <span className="ml-auto text-[12px] font-semibold tabular-nums text-charcoal-soft">
            {total} passage{total === 1 ? "" : "s"}
          </span>
        </div>
      </div>

      {lang === "en" && showMeaning ? (
        <p className="mb-5 rounded-control border border-gold/25 bg-gold-soft/30 px-3.5 py-2 text-[12px] text-charcoal-soft">
          English translations are drafts, pending review by the team.
        </p>
      ) : null}

      {/* Every passage of the sub-section, in order. Read straight down; the
          in-line headings NU ships stay attached to the passage they open. */}
      <div className="space-y-4">
        {pages.map((page, idx) => {
          const p = page.p;
          const heading = page.hdr ? meaningOf(page.hdr) || page.hdr.id_ : null;
          const meaning = meaningOf(p);

          return (
            <section key={p.id ?? idx}>
              {heading ? (
                <h2 className="mb-3 mt-6 flex items-center gap-2 font-heading text-[13px] font-bold uppercase tracking-wide text-charcoal-soft first:mt-0">
                  <span className="h-px w-4 flex-shrink-0 bg-gold" aria-hidden="true" />
                  {heading}
                </h2>
              ) : null}

              <article className="rounded-card border border-line bg-white px-4 py-5 sm:px-6 sm:py-6">
                {p.ar ? (
                  <p
                    lang="ar"
                    dir="rtl"
                    className="text-ink"
                    style={{
                      fontFamily: ARABIC_STACK,
                      fontSize: `${sizes.ar}px`,
                      lineHeight: arabicLineHeight(sizes.ar),
                      whiteSpace: "pre-line",
                    }}
                  >
                    {p.ar}
                  </p>
                ) : null}

                {showTranslit && p.tr ? (
                  <p
                    className="mt-3 italic leading-relaxed text-charcoal-soft"
                    style={{ fontSize: `${sizes.tr}px`, whiteSpace: "pre-line" }}
                  >
                    {p.tr}
                  </p>
                ) : null}

                {showMeaning ? (
                  meaning ? (
                    <p
                      className="mt-3 border-t border-line pt-3 leading-relaxed text-charcoal"
                      style={{ fontSize: `${sizes.mn}px`, whiteSpace: "pre-line" }}
                    >
                      {meaning}
                    </p>
                  ) : (
                    <p className="mt-3 border-t border-line pt-3 text-[12.5px] italic text-charcoal-soft/70">
                      {lang === "en"
                        ? "No English translation for this passage."
                        : "Tiada terjemahan untuk bagian ini."}
                    </p>
                  )
                ) : null}
              </article>
            </section>
          );
        })}
      </div>

      {/* The swipe made visible, and the only way to cross for anyone on a
          mouse. At either end the button goes dead rather than disappearing —
          collapsing it would shift the other side across. */}
      <nav className="mt-6 grid grid-cols-2 gap-2.5" aria-label="Sections">
        <SectionButton side="prev" target={prev} />
        <SectionButton side="next" target={next} />
      </nav>

      {upHref ? (
        <p className="mt-4 text-center text-[11.5px] text-charcoal-soft/70">
          Scroll to read {title} through. Swipe or use the ← → keys for the next section.{" "}
          <Link href={upHref} className="font-semibold text-gold hover:text-gold-hover">
            Back to all sections
          </Link>
        </p>
      ) : null}

      {sizeOpen ? (
        <TextSizeSheet
          sizes={sizes}
          onChange={setSize}
          onReset={resetSizes}
          onClose={() => setSizeOpen(false)}
        />
      ) : null}
    </div>
  );
}

/**
 * Text size, presented as in the Quran reader: a bottom sheet with one slider
 * per layer over the same px ranges, plus a reset. Sliders rather than an
 * A−/A+ stepper because the three layers are read by different people for
 * different reasons — a teacher projecting the Arabic wants it huge without
 * dragging the meaning up with it.
 */
function TextSizeSheet({ sizes, onChange, onReset, onClose }) {
  // Escape closes, as it does for every other overlay in the portal.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Text size"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86vh] w-full max-w-[560px] flex-col rounded-t-[24px] bg-white p-4 shadow-[0_-8px_24px_rgba(74,51,64,0.18)]"
      >
        <div className="mx-auto mb-3.5 h-1.5 w-11 flex-none rounded-pill bg-line" />

        <div className="flex-1 overflow-y-auto px-0.5 pb-2">
          <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">
            Text size
          </h3>
          <div className="space-y-3.5">
            {Object.entries(SIZE_RANGE).map(([key, cfg]) => (
              <label key={key} className="block">
                <span className="mb-1 flex items-center justify-between text-[13px] text-charcoal">
                  {cfg.label}
                  <span className="text-[12px] tabular-nums text-charcoal-soft">{sizes[key]}px</span>
                </span>
                <input
                  type="range"
                  min={cfg.min}
                  max={cfg.max}
                  step={1}
                  value={sizes[key]}
                  onChange={(e) => onChange(key, Number(e.target.value))}
                  className="w-full accent-ink"
                  aria-label={`${cfg.label} text size`}
                />
              </label>
            ))}
          </div>

          <div className="mt-6 flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={onReset}
              className="text-[13px] font-semibold text-charcoal-soft underline-offset-2 hover:text-charcoal hover:underline"
            >
              Reset to defaults
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-control bg-ink px-5 py-2 text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep"
            >
              Done
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

/**
 * One side of the section pager. A link when there is a neighbouring
 * sub-section, and a disabled placeholder at the ends of the collection.
 */
function SectionButton({ side, target }) {
  const isNext = side === "next";
  const shape = `flex items-center gap-3 rounded-card border px-4 py-3 text-left ${
    isNext ? "flex-row-reverse text-right" : ""
  }`;

  if (!target) {
    return (
      <span className={`${shape} border-dashed border-line text-[12.5px] text-charcoal-soft/50`}>
        <span className="flex-1">{isNext ? "End of the collection" : "Start of the collection"}</span>
      </span>
    );
  }

  return (
    <Link
      href={target.href}
      className={`${shape} border-line bg-white transition-colors hover:border-gold hover:bg-paper`}
    >
      <span className="flex-none text-charcoal-soft">
        <Icon name={isNext ? "chevron-right" : "arrow-left"} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-charcoal-soft/70">
          {isNext ? "Next section" : "Previous section"}
        </span>
        <span className="block break-words font-heading text-[13.5px] font-bold leading-snug text-charcoal">
          {target.title}
        </span>
      </span>
    </Link>
  );
}

function Segmented({ value, onChange, options }) {
  return (
    <div className="inline-flex rounded-pill border border-line bg-white p-0.5">
      {options.map((o) => {
        const active = o.key === value;
        return (
          <button
            key={o.key}
            type="button"
            onClick={() => onChange(o.key)}
            className={`rounded-pill px-3 py-1 text-[12.5px] font-semibold transition-colors ${
              active ? "bg-ink text-paper" : "text-charcoal-soft hover:text-charcoal"
            }`}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

function Toggle({ label, on, onClick }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={`inline-flex items-center gap-1.5 rounded-pill border px-2.5 py-1 text-[12px] font-medium transition-colors ${
        on
          ? "border-gold/40 bg-gold-soft/40 text-charcoal"
          : "border-line bg-white text-charcoal-soft/70 hover:text-charcoal"
      }`}
    >
      <span
        className={`inline-block h-1.5 w-1.5 rounded-full ${on ? "bg-gold" : "bg-charcoal-soft/30"}`}
      />
      {label}
    </button>
  );
}

function StepBtn({ children, onClick, disabled, label }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      className="flex h-7 w-7 items-center justify-center text-charcoal transition-colors hover:bg-gold-soft/40 disabled:cursor-not-allowed disabled:text-charcoal-soft/30 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  );
}

function PlayGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <path d="M3 2.2v7.6a.5.5 0 0 0 .77.42l6-3.8a.5.5 0 0 0 0-.84l-6-3.8A.5.5 0 0 0 3 2.2Z" />
    </svg>
  );
}

function PauseGlyph() {
  return (
    <svg width="11" height="11" viewBox="0 0 12 12" fill="currentColor" aria-hidden="true">
      <rect x="2.5" y="2" width="2.5" height="8" rx="0.6" />
      <rect x="7" y="2" width="2.5" height="8" rx="0.6" />
    </svg>
  );
}
