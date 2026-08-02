"use client";

import { useEffect, useMemo, useState } from "react";

const LANGS = [
  { key: "en", label: "English" },
  { key: "id", label: "Bahasa" },
];

const PREF_KEY = "lqk.dzikir.prefs";

/**
 * The devotional reader. Every passage shows the Arabic (Amiri, RTL); the
 * transliteration and the meaning are togglable, and the meaning follows a
 * language picker that defaults to English (Little Quran Kids teaches an
 * English-first, mixed-ability team) with Bahasa Indonesia as the alternate.
 *
 * The English is a hand-translation still under review, so it is labelled as a
 * draft rather than presented as final.
 */
export default function DzikirReader({ passages }) {
  const [lang, setLang] = useState("en");
  const [showTranslit, setShowTranslit] = useState(true);
  const [showMeaning, setShowMeaning] = useState(true);
  const [loaded, setLoaded] = useState(false);

  // Restore preferences once, client-side, so SSR markup stays stable.
  useEffect(() => {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || "{}");
      if (p.lang === "en" || p.lang === "id") setLang(p.lang);
      if (typeof p.showTranslit === "boolean") setShowTranslit(p.showTranslit);
      if (typeof p.showMeaning === "boolean") setShowMeaning(p.showMeaning);
    } catch {}
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ lang, showTranslit, showMeaning }));
    } catch {}
  }, [loaded, lang, showTranslit, showMeaning]);

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

  return (
    <div>
      {/* Controls */}
      <div className="sticky top-0 z-10 -mx-8 mb-5 border-b border-line bg-paper/95 px-8 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <Segmented value={lang} onChange={setLang} options={LANGS} />
          <Toggle label="Transliteration" on={showTranslit} onClick={() => setShowTranslit((v) => !v)} />
          <Toggle label="Meaning" on={showMeaning} onClick={() => setShowMeaning((v) => !v)} />
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
                        className="font-arabic text-[26px] leading-[2] text-ink"
                        lang="ar"
                        dir="rtl"
                      >
                        {p.ar}
                      </p>
                    ) : null}

                    {showTranslit && p.tr ? (
                      <p className="mt-3 text-[13.5px] italic leading-relaxed text-charcoal-soft">
                        {p.tr}
                      </p>
                    ) : null}

                    {showMeaning ? (
                      meaning ? (
                        <p className="mt-3 border-t border-line pt-3 text-[14px] leading-relaxed text-charcoal">
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
