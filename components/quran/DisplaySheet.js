"use client";

import { useMemo } from "react";
import { parseTajweed, tajweedRule, rulesPresent } from "@/lib/quran/tajweed";
import { MAKHRAJ_REGIONS } from "@/lib/quran/makhraj";

const MODES = [
  { key: "plain", label: "Plain" },
  { key: "tajweed", label: "Tajweed" },
  { key: "makhraj", label: "Makhraj" },
];

const SIZE_RANGE = {
  arabicSize: { label: "Arabic", min: 20, max: 60 },
  translitSize: { label: "Transliteration", min: 10, max: 26 },
  translationSize: { label: "Translation", min: 11, max: 26 },
};

const COLOR_KEYS = {
  arabicColor: "Arabic",
  translitColor: "Transliteration",
  translationColor: "Translation",
};

// Curated on-brand palette + a few high-contrast extras.
const SWATCHES = [
  "#3A3026", "#7A6E5C", "#D88A4F", "#B86F3A", "#C99A35",
  "#A8742A", "#B5573C", "#2E8B70", "#3B6FB0", "#111111",
];

export default function DisplaySheet({ state, store, onClose }) {
  const { settings, displayMode } = state;

  // Legend: for tajweed, only the rules that actually occur in this surah.
  const legend = useMemo(() => {
    if (displayMode === "tajweed") {
      const present = rulesPresent(state.verses.map((v) => parseTajweed(v.textTajweed)));
      return present.map((cls) => ({ ...tajweedRule(cls), key: cls }));
    }
    if (displayMode === "makhraj") {
      return Object.entries(MAKHRAJ_REGIONS).map(([key, r]) => ({ key, label: r.label, color: r.color }));
    }
    return [];
  }, [displayMode, state.verses]);

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Display settings"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86vh] w-full max-w-[560px] flex-col rounded-t-[24px] bg-white p-4 shadow-[0_-8px_24px_rgba(58,48,38,0.18)]"
      >
        <div className="mx-auto mb-3.5 h-1.5 w-11 flex-none rounded-pill bg-line" />

        <div className="flex-1 space-y-6 overflow-y-auto px-0.5 pb-2">
          {/* Show / hide layers */}
          <Section title="Show">
            <div className="space-y-2.5">
              <Switch
                label="Transliteration"
                checked={state.showTransliteration}
                onChange={() => store.toggleTransliteration()}
              />
              <Switch
                label="Translation"
                checked={state.showTranslation}
                onChange={() => store.toggleTranslation()}
              />
            </div>
          </Section>

          {/* Arabic script mode */}
          <Section title="Arabic script">
            <div className="flex rounded-pill bg-paper-deep p-1" role="tablist">
              {MODES.map((m) => (
                <button
                  key={m.key}
                  type="button"
                  role="tab"
                  aria-selected={displayMode === m.key}
                  onClick={() => store.setDisplayMode(m.key)}
                  className={`flex-1 rounded-pill py-2 text-[13px] font-semibold transition-colors ${
                    displayMode === m.key ? "bg-ink text-paper shadow-sm" : "text-charcoal-soft"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
            {displayMode !== "plain" && (
              <p className="mt-2 text-[12px] text-charcoal-soft">
                {displayMode === "tajweed"
                  ? "Colour-coded tajweed rules. Word tap-to-translate pauses in this mode."
                  : "Letters coloured by articulation point (makhraj). و and ي join the cavity group when used for prolongation."}
              </p>
            )}
            {legend.length > 0 && (
              <ul className="mt-3 grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                {legend.map((item) => (
                  <li key={item.key} className="flex items-center gap-2 text-[12px] text-charcoal">
                    <span
                      className="h-3 w-3 flex-none rounded-full"
                      style={{ backgroundColor: item.color }}
                      aria-hidden="true"
                    />
                    {item.label}
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {/* Text size */}
          <Section title="Text size">
            <div className="space-y-3.5">
              {Object.entries(SIZE_RANGE).map(([key, cfg]) => (
                <label key={key} className="block">
                  <span className="mb-1 flex items-center justify-between text-[13px] text-charcoal">
                    {cfg.label}
                    <span className="text-[12px] tabular-nums text-charcoal-soft">{settings[key]}px</span>
                  </span>
                  <input
                    type="range"
                    min={cfg.min}
                    max={cfg.max}
                    step={1}
                    value={settings[key]}
                    onChange={(e) => store.setSetting(key, Number(e.target.value))}
                    className="w-full accent-ink"
                    aria-label={`${cfg.label} text size`}
                  />
                </label>
              ))}
            </div>
          </Section>

          {/* Text colour */}
          <Section title="Text colour">
            <div className="space-y-3.5">
              {Object.entries(COLOR_KEYS).map(([key, label]) => (
                <div key={key}>
                  <div className="mb-1.5 text-[13px] text-charcoal">{label}</div>
                  <div className="flex flex-wrap items-center gap-2">
                    {SWATCHES.map((hex) => {
                      const selected = settings[key].toLowerCase() === hex.toLowerCase();
                      return (
                        <button
                          key={hex}
                          type="button"
                          aria-label={`${label} colour ${hex}`}
                          aria-pressed={selected}
                          onClick={() => store.setSetting(key, hex)}
                          className={`h-7 w-7 rounded-full border transition-transform ${
                            selected ? "scale-110 border-charcoal" : "border-line"
                          }`}
                          style={{ backgroundColor: hex }}
                        />
                      );
                    })}
                    <label
                      className="flex h-7 w-7 cursor-pointer items-center justify-center overflow-hidden rounded-full border border-line"
                      title="Custom colour"
                    >
                      <input
                        type="color"
                        value={settings[key]}
                        onChange={(e) => store.setSetting(key, e.target.value)}
                        className="h-9 w-9 cursor-pointer border-0 bg-transparent p-0"
                        aria-label={`${label} custom colour`}
                      />
                    </label>
                  </div>
                </div>
              ))}
            </div>
          </Section>

          <div className="flex items-center justify-between pt-1">
            <button
              type="button"
              onClick={() => store.resetSettings()}
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

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-2.5 text-[12px] font-bold uppercase tracking-wide text-charcoal-soft">{title}</h3>
      {children}
    </section>
  );
}

function Switch({ label, checked, onChange }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className="flex w-full items-center justify-between text-[14px] text-charcoal"
    >
      {label}
      <span className={`relative h-6 w-11 flex-none rounded-pill transition-colors ${checked ? "bg-ink" : "bg-paper-deep"}`}>
        <span
          className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow-sm transition-all ${
            checked ? "left-[22px]" : "left-0.5"
          }`}
        />
      </span>
    </button>
  );
}
