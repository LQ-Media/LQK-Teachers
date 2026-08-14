"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";

/* A text input that also offers a list.

   Built rather than reached for because the two places that need it — dress
   code and max party size — both have to accept a value that ISN'T in the list.
   A <select> can't do that, and a <datalist> can't group its options or be
   styled, which matters when the party-size list is a hundred entries long.

   Behaviour: type freely and whatever is typed is the value; the list filters
   as you type and is never a gate. Arrow keys move, Enter takes the highlighted
   option, Escape closes without changing anything.

   The entrance is .lqk-pop-in (app/globals.css) — a CSS animation, not a
   React mounted-flag, so it can't be left half-played by a paused rAF. */
export default function Combobox({
  id,
  value,
  onChange,
  groups = [],
  placeholder,
  inputMode,
  ariaLabel,
  className = "",
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState(null); // null = "showing the saved value"
  const [active, setActive] = useState(-1);
  const wrapRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const text = query ?? String(value ?? "");

  /* Filter on the typed text only. Once something is chosen, `query` resets to
     null so reopening shows the whole list rather than the one option that
     matches what is already in the box. */
  const filtered = useMemo(() => {
    const needle = (query ?? "").trim().toLowerCase();
    return groups
      .map((g) => ({
        label: g.label,
        options: needle ? g.options.filter((o) => o.toLowerCase().includes(needle)) : g.options,
      }))
      .filter((g) => g.options.length);
  }, [groups, query]);

  const flat = useMemo(() => filtered.flatMap((g) => g.options), [filtered]);

  useEffect(() => {
    if (!open) return undefined;
    function onDocPointerDown(e) {
      if (!wrapRef.current?.contains(e.target)) close();
    }
    document.addEventListener("pointerdown", onDocPointerDown);
    return () => document.removeEventListener("pointerdown", onDocPointerDown);
  }, [open]);

  // Keep the highlighted row in view when arrowing through a long list.
  useEffect(() => {
    if (!open || active < 0) return;
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  /* The single exit. Every path that closes the panel goes through here, so
     reopening always remounts the panel and replays its entrance. */
  function close() {
    setOpen(false);
    setQuery(null);
    setActive(-1);
  }

  function pick(option) {
    onChange(option);
    close();
    inputRef.current?.focus();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) {
        setOpen(true);
        setActive(0);
        return;
      }
      const step = e.key === "ArrowDown" ? 1 : -1;
      setActive((i) => {
        const next = i + step;
        if (next < 0) return flat.length - 1;
        if (next >= flat.length) return 0;
        return next;
      });
      return;
    }
    if (e.key === "Enter" && open && active >= 0 && flat[active]) {
      e.preventDefault();
      pick(flat[active]);
      return;
    }
    if (e.key === "Escape" && open) {
      e.preventDefault();
      e.stopPropagation();
      close();
    }
  }

  let runningIndex = -1;

  return (
    <div ref={wrapRef} className={`relative ${className}`}>
      <div className="relative">
        <input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-label={ariaLabel}
          autoComplete="off"
          inputMode={inputMode}
          className="w-full rounded-control border border-line bg-paper py-2.5 pe-10 ps-3 text-base text-ink outline-none focus:border-gold"
          value={text}
          placeholder={placeholder}
          onChange={(e) => {
            setQuery(e.target.value);
            onChange(e.target.value);
            setOpen(true);
            setActive(-1);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-hidden
          onPointerDown={(e) => {
            // pointerdown, not click: the document listener above closes on
            // pointerdown, so a click handler here would reopen what it closed.
            e.preventDefault();
            if (open) close();
            else {
              setOpen(true);
              inputRef.current?.focus();
            }
          }}
          className="absolute inset-y-0 end-0 grid w-10 place-items-center text-charcoal-soft transition-transform duration-150 ease-out active:scale-[0.9]"
        >
          <svg width="12" height="8" viewBox="0 0 12 8" fill="none" aria-hidden>
            <path
              d="M1 1.5 6 6.5l5-5"
              stroke="currentColor"
              strokeWidth="1.75"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      </div>

      {open && filtered.length ? (
        <div
          id={listId}
          ref={listRef}
          role="listbox"
          className="lqk-pop-in absolute inset-x-0 top-[calc(100%_+_4px)] z-30 max-h-72 overflow-y-auto rounded-control border border-line bg-white py-1 shadow-[0_12px_32px_-12px_rgba(23,23,23,0.28)]"
        >
          {filtered.map((group) => (
            <div key={group.label}>
              <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wide text-charcoal-soft">
                {group.label}
              </p>
              {group.options.map((option) => {
                runningIndex += 1;
                const index = runningIndex;
                const selected = String(value ?? "") === option;
                return (
                  <button
                    key={option}
                    type="button"
                    role="option"
                    aria-selected={selected}
                    data-index={index}
                    onMouseEnter={() => setActive(index)}
                    onPointerDown={(e) => {
                      e.preventDefault();
                      pick(option);
                    }}
                    className={`flex w-full items-center justify-between gap-2 px-3 py-2 text-start text-sm transition-colors duration-100 ${
                      index === active ? "bg-paper text-ink" : "text-charcoal-soft"
                    }`}
                  >
                    <span>{option}</span>
                    {selected ? <span className="text-gold">✓</span> : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
