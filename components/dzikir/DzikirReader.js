"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Icon from "@/components/Icon";

// A horizontal drag counts as a page turn when it is decisively sideways:
// far enough to be deliberate, and clearly more horizontal than vertical so
// that scrolling a long litany never flips the page by accident.
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

// Font-size steps: Arabic drives the scale, transliteration and meaning follow.
const SIZES = [
  { ar: 22, lh: 2.0, tr: 12.5, mn: 13 },
  { ar: 26, lh: 2.0, tr: 13.5, mn: 14 },
  { ar: 30, lh: 2.05, tr: 14.5, mn: 15 },
  { ar: 36, lh: 2.1, tr: 15.5, mn: 16 },
  { ar: 44, lh: 2.15, tr: 17, mn: 18 },
];
const DEFAULT_SIZE = 2;

const SPEED_MIN = 1;
const SPEED_MAX = 5;
const DEFAULT_SPEED = 2;

const PREF_KEY = "lqk.dzikir.prefs";

/**
 * The devotional reader: ONE passage on screen at a time.
 *
 * Paging is horizontal — swipe, ← →, or the buttons under the passage — and
 * runs inside the current sub-section. At either end the same gesture crosses
 * into the neighbouring sub-section (`prev`/`next`), which is a real
 * navigation; everything in between is local state, so a page turn is instant.
 *
 * Reading aids carried over from the scrolling reader: an A−/A+ size stepper,
 * transliteration/meaning toggles, an English⇄Bahasa picker, and a hands-free
 * auto-scroll for the long passages that still outrun a screen.
 */
export default function DzikirReader({ pages, title, prev = null, next = null, upHref = null }) {
  const router = useRouter();
  const [i, setI] = useState(0);
  const [lang, setLang] = useState("en");
  const [showTranslit, setShowTranslit] = useState(true);
  const [showMeaning, setShowMeaning] = useState(true);
  const [size, setSize] = useState(DEFAULT_SIZE);
  const [scrolling, setScrolling] = useState(false);
  const [speed, setSpeed] = useState(DEFAULT_SPEED);
  const [loaded, setLoaded] = useState(false);

  // Restore preferences once, client-side, so SSR markup stays stable.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      if (p.lang === "en" || p.lang === "id") setLang(p.lang);
      if (typeof p.showTranslit === "boolean") setShowTranslit(p.showTranslit);
      if (typeof p.showMeaning === "boolean") setShowMeaning(p.showMeaning);
      if (Number.isInteger(p.size) && p.size >= 0 && p.size < SIZES.length) setSize(p.size);
      if (Number.isInteger(p.speed) && p.speed >= SPEED_MIN && p.speed <= SPEED_MAX) setSpeed(p.speed);
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(
        PREF_KEY,
        JSON.stringify({ lang, showTranslit, showMeaning, size, speed })
      );
    } catch {}
  }, [loaded, lang, showTranslit, showMeaning, size, speed]);

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

  // ── Paging ────────────────────────────────────────────────────────────────
  // Within the sub-section this is local state; past either end it hands over
  // to the neighbouring sub-section's route.
  // The index is mirrored in a ref and moved eagerly, so a burst of arrow-key
  // presses advances by one each — reading `i` from the closure would make them
  // all compute the same target — and so the scroll reset stays out of the
  // state updater, which has to be pure.
  const iRef = useRef(0);
  const step = useCallback(
    (delta) => {
      setScrolling(false); // never carry auto-scroll across a page turn
      const target = iRef.current + delta;
      if (target >= 0 && target < total) {
        iRef.current = target;
        setI(target);
        // Back to the top: the passage just left may have been long, and the
        // next one starts at its own beginning.
        window.scrollTo({ top: 0, behavior: "auto" });
        return;
      }
      const cross = delta > 0 ? next : prev;
      if (cross) router.push(cross.href);
    },
    [total, prev, next, router]
  );

  // Arrow keys page on desktop. Ignored while typing in a field, and never when
  // a modifier is held (that is a browser shortcut, e.g. ⌘← for Back).
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "ArrowRight") step(1);
      else if (e.key === "ArrowLeft") step(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [step]);

  // Touch paging. Recorded on the container rather than the window so a swipe
  // that starts on the sticky control bar doesn't turn the page.
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
      // A text selection drag is not a page turn.
      if (window.getSelection?.()?.toString()) return;

      const t = e.changedTouches?.[0];
      if (!t) return;
      const dx = t.clientX - start.x;
      const dy = t.clientY - start.y;
      if (Date.now() - start.at > SWIPE_MAX_MS) return;
      if (Math.abs(dx) < SWIPE_MIN_PX) return;
      if (Math.abs(dx) < Math.abs(dy) * SWIPE_RATIO) return;

      step(dx < 0 ? 1 : -1); // drag left → next, drag right → previous
    },
    [step]
  );

  const meaningOf = (p) => (p ? (lang === "en" ? p.en : p.id_) : "");
  const sz = SIZES[size];
  const decSize = useCallback(() => setSize((s) => Math.max(0, s - 1)), []);
  const incSize = useCallback(() => setSize((s) => Math.min(SIZES.length - 1, s + 1)), []);

  if (!total) {
    return (
      <p className="rounded-card border border-line bg-white px-4 py-8 text-center text-[13px] text-charcoal-soft">
        This section has no passages.
      </p>
    );
  }

  const page = pages[Math.min(i, total - 1)];
  const p = page.p;
  const heading = page.hdr ? meaningOf(page.hdr) || page.hdr.id_ : null;
  const meaning = meaningOf(p);

  const atStart = i === 0;
  const atEnd = i === total - 1;

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Controls, pinned so they stay reachable inside a long passage. The
          negative margins bleed the bar to the page edges and must track the
          page's own padding (px-4 on phones, p-8 from sm up). */}
      <div className="sticky top-0 z-10 -mx-4 mb-5 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur sm:-mx-8 sm:px-8">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <Segmented value={lang} onChange={setLang} options={LANGS} />
          <Toggle label="Transliteration" on={showTranslit} onClick={() => setShowTranslit((v) => !v)} />
          <Toggle label="Meaning" on={showMeaning} onClick={() => setShowMeaning((v) => !v)} />

          {/* Font size */}
          <div className="inline-flex items-center overflow-hidden rounded-pill border border-line bg-white">
            <StepBtn label="Smaller text" onClick={decSize} disabled={size === 0}>
              <span className="text-[12px] font-bold">A</span>
            </StepBtn>
            <span className="px-1 text-[11px] tabular-nums text-charcoal-soft/70">{sz.ar}</span>
            <StepBtn label="Larger text" onClick={incSize} disabled={size === SIZES.length - 1}>
              <span className="text-[16px] font-bold">A</span>
            </StepBtn>
          </div>

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

          {/* Where you are in the sub-section — the one thing a single-passage
              screen cannot show implicitly the way a scrolling list did. */}
          <span className="ml-auto text-[12px] font-semibold tabular-nums text-charcoal-soft">
            {i + 1} / {total}
          </span>
        </div>
      </div>

      {lang === "en" && showMeaning ? (
        <p className="mb-5 rounded-control border border-gold/25 bg-gold-soft/30 px-3.5 py-2 text-[12px] text-charcoal-soft">
          English translations are drafts, pending review by the team.
        </p>
      ) : null}

      {heading ? (
        <h2 className="mb-3 flex items-center gap-2 font-heading text-[13px] font-bold uppercase tracking-wide text-charcoal-soft">
          <span className="h-px w-4 flex-shrink-0 bg-gold" aria-hidden="true" />
          {heading}
        </h2>
      ) : null}

      <article
        key={p.id}
        className="lqk-rise rounded-card border border-line bg-white px-4 py-5 sm:px-6 sm:py-6"
      >
        {p.ar ? (
          <p
            lang="ar"
            dir="rtl"
            className="text-ink"
            style={{
              fontFamily: ARABIC_STACK,
              fontSize: `${sz.ar}px`,
              lineHeight: sz.lh,
              whiteSpace: "pre-line",
            }}
          >
            {p.ar}
          </p>
        ) : null}

        {showTranslit && p.tr ? (
          <p
            className="mt-3 italic leading-relaxed text-charcoal-soft"
            style={{ fontSize: `${sz.tr}px`, whiteSpace: "pre-line" }}
          >
            {p.tr}
          </p>
        ) : null}

        {showMeaning ? (
          meaning ? (
            <p
              className="mt-3 border-t border-line pt-3 leading-relaxed text-charcoal"
              style={{ fontSize: `${sz.mn}px`, whiteSpace: "pre-line" }}
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

      {/* The swipe made visible, and the only way to page for anyone on a mouse
          or a keyboard. At either end the button crosses into the neighbouring
          sub-section rather than going dead. */}
      <nav className="mt-6 grid grid-cols-2 gap-2.5" aria-label="Passages">
        <PageButton
          side="prev"
          label={atStart ? prev?.title : "Previous"}
          sublabel={atStart ? "Previous section" : `Passage ${i}`}
          href={atStart ? prev?.href : null}
          onClick={atStart ? null : () => step(-1)}
          disabled={atStart && !prev}
        />
        <PageButton
          side="next"
          label={atEnd ? next?.title : "Next"}
          sublabel={atEnd ? "Next section" : `Passage ${i + 2}`}
          href={atEnd ? next?.href : null}
          onClick={atEnd ? null : () => step(1)}
          disabled={atEnd && !next}
        />
      </nav>

      {upHref ? (
        <p className="mt-4 text-center text-[11.5px] text-charcoal-soft/70">
          Swipe or use the ← → keys to move through {title}.{" "}
          <Link href={upHref} className="font-semibold text-gold hover:text-gold-hover">
            Back to all sections
          </Link>
        </p>
      ) : null}
    </div>
  );
}

/**
 * One side of the pager. Renders as a link when the tap leaves this page and a
 * button when it does not, and as a disabled placeholder at the very ends —
 * collapsing it would shift the other side across mid-read.
 */
function PageButton({ side, label, sublabel, href, onClick, disabled }) {
  const isNext = side === "next";
  const inner = (
    <>
      <span className="flex-none text-charcoal-soft">
        <Icon name={isNext ? "chevron-right" : "arrow-left"} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-charcoal-soft/70">
          {sublabel}
        </span>
        <span className="block break-words font-heading text-[13.5px] font-bold leading-snug text-charcoal">
          {label}
        </span>
      </span>
    </>
  );

  const shape = `flex items-center gap-3 rounded-card border px-4 py-3 text-left ${
    isNext ? "flex-row-reverse text-right" : ""
  }`;

  if (disabled) {
    return (
      <span className={`${shape} border-dashed border-line text-[12.5px] text-charcoal-soft/50`}>
        <span className="flex-1">{isNext ? "End of the collection" : "Start of the collection"}</span>
      </span>
    );
  }

  if (href) {
    return (
      <Link href={href} className={`${shape} border-line bg-white transition-colors hover:border-gold hover:bg-paper`}>
        {inner}
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={`${shape} w-full border-line bg-white transition-colors hover:border-gold hover:bg-paper`}>
      {inner}
    </button>
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
