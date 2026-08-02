"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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
export default function DzikirReader({ passages }) {
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

  return (
    <div>
      {/* Controls */}
      <div className="sticky top-0 z-10 -mx-8 mb-5 border-b border-line bg-paper/95 px-8 py-3 backdrop-blur">
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
    </div>
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
