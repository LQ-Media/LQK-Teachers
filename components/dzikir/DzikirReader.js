"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
 * The devotional reader. Every passage shows the Arabic in one self-hosted
 * naskh face (so it looks the same on every device); transliteration and the
 * meaning are togglable, and the meaning follows an English-first language
 * picker with Bahasa Indonesia as the alternate.
 *
 * Reading aids: an A−/A+ size stepper and a hands-free auto-scroll (play/pause
 * plus speed) that drives the window scroll and bows out the moment the reader
 * touches the wheel or the screen.
 */
export default function DzikirReader({
  passages,
  prev = null,
  next = null,
  siblings = [],
  activeKey = null,
}) {
  const router = useRouter();
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

  // Group passages under their sub-section headings, preserving order.
  const groups = useMemo(() => {
    const out = [];
    for (const p of passages) {
      const sub = p.sub || "";
      if (!out.length || out[out.length - 1].sub !== sub) out.push({ sub, items: [] });
      out[out.length - 1].items.push(p);
    }
    return out;
  }, [passages]);

  const meaningOf = (p) => (lang === "en" ? p.en : p.id_);
  const sz = SIZES[size];

  const decSize = useCallback(() => setSize((s) => Math.max(0, s - 1)), []);
  const incSize = useCallback(() => setSize((s) => Math.min(SIZES.length - 1, s + 1)), []);

  // ── Paging between collections ────────────────────────────────────────────
  const hrefOf = (t) => (t ? `/dzikir/${t.group}/${t.slug}` : null);

  const goTo = useCallback(
    (target) => {
      if (!target) return;
      setScrolling(false); // never carry auto-scroll across a page turn
      router.push(`/dzikir/${target.group}/${target.slug}`);
    },
    [router]
  );

  // Arrow keys page between collections on desktop. Ignored while the reader is
  // typing in a field, and never when a modifier is held (that is a browser
  // shortcut, e.g. ⌘← for Back).
  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey || e.shiftKey) return;
      const el = document.activeElement;
      const tag = el?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el?.isContentEditable) return;
      if (e.key === "ArrowRight") goTo(next);
      else if (e.key === "ArrowLeft") goTo(prev);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [goTo, prev, next]);

  // Centre the open collection in the sibling strip on arrival, so the ones
  // either side are visible without hunting. offsetLeft is relative to the
  // offsetParent, not the strip, so measure the two rects instead.
  //
  // Re-run once the webfonts land: the first measurement happens in the
  // fallback face, whose wider glyphs put every tab at the wrong offset, and
  // the strip ends up scrolled well past the active tab. The maths is
  // idempotent (an already-centred strip computes a zero delta), so repeating
  // it is free.
  const tabsRef = useRef(null);
  useEffect(() => {
    const centre = () => {
      const strip = tabsRef.current;
      if (!strip) return;
      const tab = strip.querySelector('[data-active="true"]');
      if (!tab) return;
      const delta = tab.getBoundingClientRect().left - strip.getBoundingClientRect().left;
      strip.scrollLeft += delta - (strip.clientWidth - tab.offsetWidth) / 2;
    };
    centre();
    document.fonts?.ready.then(centre).catch(() => {});
    window.addEventListener("resize", centre);
    return () => window.removeEventListener("resize", centre);
  }, [activeKey]);

  // Drag the strip sideways with a mouse — touch already has native momentum
  // scrolling, so this is pointer-type gated. A drag must not also open the
  // collection it started on, hence the capture-phase click swallow.
  const drag = useRef(null);

  const onStripPointerDown = useCallback((e) => {
    if (e.pointerType !== "mouse") return;
    drag.current = { x: e.clientX, scroll: e.currentTarget.scrollLeft, moved: false };
  }, []);

  const onStripPointerMove = useCallback((e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    if (Math.abs(dx) > 4) d.moved = true;
    e.currentTarget.scrollLeft = d.scroll - dx;
  }, []);

  const onStripPointerUp = useCallback(() => {
    if (drag.current) drag.current.up = true;
  }, []);

  const onStripClickCapture = useCallback((e) => {
    if (drag.current?.moved) {
      e.preventDefault();
      e.stopPropagation();
    }
    drag.current = null;
  }, []);

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

      goTo(dx < 0 ? next : prev); // drag left → next, drag right → previous
    },
    [goTo, prev, next]
  );

  return (
    <div onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
      {/* Sibling strip + controls, pinned so both stay reachable mid-litany.
          The negative margins bleed the bar to the page edges and must track
          the page's own padding (px-4 on phones, p-8 from sm up). */}
      <div className="sticky top-0 z-10 -mx-4 mb-5 border-b border-line bg-paper/95 px-4 py-2.5 backdrop-blur sm:-mx-8 sm:px-8">
        {siblings.length > 1 && (
          <div
            ref={tabsRef}
            aria-label="Collections in this section"
            onPointerDown={onStripPointerDown}
            onPointerMove={onStripPointerMove}
            onPointerUp={onStripPointerUp}
            onPointerLeave={onStripPointerUp}
            onClickCapture={onStripClickCapture}
            className="-mx-4 mb-1.5 flex gap-2 overflow-x-auto px-4 py-2.5 [-ms-overflow-style:none] [scrollbar-width:none] sm:-mx-8 sm:px-8 [&::-webkit-scrollbar]:hidden"
            style={{ touchAction: "pan-x pan-y", cursor: "grab" }}
          >
            {siblings.map((s) => {
              const active = s.key === activeKey;
              return (
                <Link
                  key={s.key}
                  href={`/dzikir/${s.group}/${s.slug}`}
                  data-active={active ? "true" : undefined}
                  aria-current={active ? "page" : undefined}
                  draggable={false}
                  className={`flex-none whitespace-nowrap rounded-control border px-4 py-2.5 text-[13px] transition-colors ${
                    active
                      ? "border-gold bg-gold-soft font-bold text-charcoal"
                      : "border-line bg-white font-medium text-charcoal-soft hover:border-gold/50 hover:text-charcoal"
                  }`}
                >
                  {s.title}
                </Link>
              );
            })}
          </div>
        )}

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
        </div>
      </div>

      {lang === "en" && showMeaning ? (
        <p className="mb-5 rounded-control border border-gold/25 bg-gold-soft/30 px-3.5 py-2 text-[12px] text-charcoal-soft">
          English translations are drafts, pending review by the team.
        </p>
      ) : null}

      <div className="space-y-6">
        {groups.map((g, gi) => (
          <section key={gi}>
            {g.sub ? (
              <h2 className="mb-3 font-heading text-[15px] font-semibold text-ink">{g.sub}</h2>
            ) : null}
            <div className="space-y-3">
              {g.items.map((p) => {
                const meaning = meaningOf(p);

                // Header rows label the passage that follows them ("Option I",
                // "Intention for Hajj"). NU ships them as ordinary records with
                // the heading sitting in the Arabic field, so before the data
                // migration they rendered as right-to-left Latin text in the
                // Amiri face, followed by a spurious "no translation" notice.
                if (p.hdr) {
                  const heading = meaningOf(p) || p.id_;
                  if (!heading) return null;
                  return (
                    <h3
                      key={p.id}
                      className="flex items-center gap-2 pt-2 pb-0.5 font-heading text-[13px] font-bold uppercase tracking-wide text-charcoal-soft"
                    >
                      <span className="h-px w-4 flex-shrink-0 bg-gold" aria-hidden="true" />
                      {heading}
                    </h3>
                  );
                }

                return (
                  <article
                    key={p.id}
                    className="rounded-card border border-line bg-white px-4 py-4 sm:px-5"
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
                        }}
                      >
                        {p.ar}
                      </p>
                    ) : null}

                    {showTranslit && p.tr ? (
                      <p
                        className="mt-3 italic leading-relaxed text-charcoal-soft"
                        style={{ fontSize: `${sz.tr}px` }}
                      >
                        {p.tr}
                      </p>
                    ) : null}

                    {showMeaning ? (
                      meaning ? (
                        <p
                          className="mt-3 border-t border-line pt-3 leading-relaxed text-charcoal"
                          style={{ fontSize: `${sz.mn}px` }}
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
                );
              })}
            </div>
          </section>
        ))}
      </div>

      {/* Paging between collections — the swipe made visible, and the only way
          to move on for anyone using a mouse or a keyboard. */}
      {(prev || next) && (
        <nav className="mt-8 border-t border-line pt-5" aria-label="Other collections">
          <div className="grid gap-2.5 sm:grid-cols-2">
            <PageLink target={prev} href={hrefOf(prev)} side="prev" />
            <PageLink target={next} href={hrefOf(next)} side="next" />
          </div>
          <p className="mt-3 text-center text-[11.5px] text-charcoal-soft/70">
            Swipe left or right to move between collections, or use the ← → keys.
          </p>
        </nav>
      )}
    </div>
  );
}

/**
 * One side of the pager. Renders a disabled placeholder rather than collapsing
 * when there is nothing that way, so the two sides stay in a stable grid and
 * the reader can see they are at the beginning or the end of the library.
 */
function PageLink({ target, href, side }) {
  const isNext = side === "next";
  const label = isNext ? "Next" : "Previous";

  if (!target) {
    return (
      <span
        className={`flex items-center gap-2 rounded-card border border-dashed border-line px-4 py-3 text-[12.5px] text-charcoal-soft/50 ${
          isNext ? "sm:justify-end sm:text-right" : ""
        }`}
      >
        {isNext ? `End of the library` : `Start of the library`}
      </span>
    );
  }

  return (
    <Link
      href={href}
      className={`flex items-center gap-3 rounded-card border border-line bg-white px-4 py-3 transition-colors hover:border-gold hover:bg-paper ${
        isNext ? "sm:flex-row-reverse sm:text-right" : ""
      }`}
    >
      <span className="flex-shrink-0 text-charcoal-soft">
        <Icon name={isNext ? "chevron-right" : "arrow-left"} size={16} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[11px] font-bold uppercase tracking-wide text-charcoal-soft/70">
          {label}
        </span>
        <span className="block truncate font-heading text-[14px] font-bold text-charcoal">
          {target.title}
        </span>
        <span className="block truncate text-[11.5px] text-charcoal-soft">{target.groupLabel}</span>
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
