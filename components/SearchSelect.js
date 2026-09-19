"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@/components/Icon";

// A picker you can type into, the way Sling's Employees filter works.
//
// LQK has ~77 staff. A plain <select> of 77 names is a scroll hunt, and the
// names share so many first words ("NUR …", "SITI …", "NURUL …") that even
// knowing who you want does not help you find them. Typing three letters does.
//
// Multi-select with checkboxes, because "show me these two teachers" is a real
// question and Sling answers it. Single-select is the same component with
// `multiple={false}`.

export default function SearchSelect({
  options, // [{ value, label, hint? }]
  value, // string (single) | string[] (multiple)
  onChange,
  multiple = false,
  placeholder = "All",
  searchPlaceholder = "Type to search",
  label,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const boxRef = useRef(null);
  const inputRef = useRef(null);

  const selected = multiple ? (Array.isArray(value) ? value : []) : value ? [value] : [];

  // Close on an outside click or Escape. Both, because a dropdown that only
  // closes one way is a dropdown somebody has to fight.
  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // Focus the search box on open. In an effect rather than during render
  // because the input does not exist until the panel is committed.
  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const filtered = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!words.length) return options;
    // EVERY word must appear, so "mar ng" finds MYA MARISHA NG. Matching on
    // "any word" would put half the roster behind a two-letter query.
    return options.filter((o) => {
      const hay = `${o.label} ${o.hint || ""}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    });
  }, [options, query]);

  const summary = (() => {
    if (!selected.length) return placeholder;
    if (!multiple) return options.find((o) => o.value === selected[0])?.label || placeholder;
    if (selected.length === 1) return options.find((o) => o.value === selected[0])?.label || "1 selected";
    return `${selected.length} selected`;
  })();

  function toggle(v) {
    if (!multiple) {
      onChange(selected[0] === v ? "" : v);
      setOpen(false);
      return;
    }
    onChange(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v]);
  }

  return (
    <div ref={boxRef} className={`relative ${className}`}>
      <button
        type="button"
        aria-label={label}
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-2 rounded-control border-[0.5px] border-line bg-paper px-2.5 py-2 text-[12px] text-charcoal hover:border-ink"
      >
        <span className={`truncate ${selected.length ? "font-semibold" : "text-charcoal-soft"}`}>{summary}</span>
        <Icon name="chevron-down" size={13} />
      </button>

      {open && (
        <div className="absolute left-0 z-50 mt-1 w-[max(100%,240px)] overflow-hidden rounded-card border-[0.5px] border-line bg-white shadow-[0_10px_30px_rgba(74,51,64,0.18)]">
          <div className="border-b-[0.5px] border-line p-2">
            <input
              ref={inputRef}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={searchPlaceholder}
              className="w-full rounded-control border-[0.5px] border-line bg-paper px-2.5 py-1.5 text-[12px] text-charcoal outline-none focus:border-ink"
            />
          </div>

          {selected.length > 0 && (
            <button
              type="button"
              onClick={() => onChange(multiple ? [] : "")}
              className="block w-full border-b-[0.5px] border-line px-3 py-2 text-left text-[12px] font-semibold text-charcoal-soft hover:bg-paper"
            >
              Clear {multiple ? `(${selected.length})` : "selection"}
            </button>
          )}

          <div className="max-h-[260px] overflow-y-auto">
            {filtered.length === 0 ? (
              <p className="px-3 py-3 text-[12px] text-charcoal-soft">Nobody matches “{query}”.</p>
            ) : (
              filtered.map((o) => {
                const on = selected.includes(o.value);
                return (
                  <button
                    key={o.value}
                    type="button"
                    onClick={() => toggle(o.value)}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left text-[12px] hover:bg-paper ${
                      on ? "font-semibold text-charcoal" : "text-charcoal"
                    }`}
                  >
                    {multiple && (
                      <span
                        aria-hidden
                        className={`flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] ${
                          on ? "border-ink bg-ink text-paper" : "border-line"
                        }`}
                      >
                        {on && <Icon name="check" size={10} />}
                      </span>
                    )}
                    <span className="min-w-0 flex-1 truncate">{o.label}</span>
                    {o.hint && <span className="shrink-0 text-[10px] text-charcoal-soft">{o.hint}</span>}
                  </button>
                );
              })
            )}
          </div>
        </div>
      )}
    </div>
  );
}
