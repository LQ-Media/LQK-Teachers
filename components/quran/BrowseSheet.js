"use client";

import { useEffect, useMemo, useState } from "react";
import Icon from "@/components/Icon";

// "18:2", "18 2", "18.2" — a surah:ayah reference typed straight into search.
const REF = /^(\d{1,3})\s*[:.\-\s]\s*(\d{1,3})$/;

export default function BrowseSheet({ state, store, onClose }) {
  const [tab, setTab] = useState("surah");
  const [query, setQuery] = useState("");
  const [ayahSurah, setAyahSurah] = useState(String(state.chapterId));
  const [ayahNum, setAyahNum] = useState("1");

  // Keep the sheet above the on-screen keyboard. Without this the sheet stays
  // pinned to the layout viewport, the keyboard covers the results, and the
  // teacher has to dismiss it before they can tap a surah.
  const [kbInset, setKbInset] = useState(0);
  const [availH, setAvailH] = useState(null);
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const sync = () => {
      setKbInset(Math.max(0, window.innerHeight - vv.height - vv.offsetTop));
      setAvailH(vv.height);
    };
    sync();
    vv.addEventListener("resize", sync);
    vv.addEventListener("scroll", sync);
    return () => {
      vv.removeEventListener("resize", sync);
      vv.removeEventListener("scroll", sync);
    };
  }, []);

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const filteredChapters = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return state.chapters;
    return state.chapters.filter(
      (c) =>
        c.nameSimple.toLowerCase().includes(q) ||
        c.translatedName.toLowerCase().includes(q) ||
        String(c.id) === q
    );
  }, [state.chapters, query]);

  function go(chapterId, verseKey) {
    store.goTo(chapterId, verseKey || null);
    onClose();
  }

  function chapterOf(id) {
    return state.chapters.find((c) => c.id === Number(id)) || null;
  }

  // A typed "18:2" becomes a direct jump offered above the results.
  const typedRef = useMemo(() => {
    const m = REF.exec(query.trim());
    if (!m) return null;
    const chapter = chapterOf(m[1]);
    if (!chapter) return null;
    const ayah = Math.min(chapter.versesCount, Math.max(1, Number(m[2])));
    return { chapter, ayah };
  }, [query, state.chapters]);

  function juzLabel(juz) {
    const chapterIds = Object.keys(juz.verseMapping)
      .map(Number)
      .sort((a, b) => a - b);
    return chapterIds
      .map((id) => {
        const c = chapterOf(id);
        return c ? `${c.nameSimple} ${juz.verseMapping[id]}` : "";
      })
      .filter(Boolean)
      .join(" · ");
  }

  function goToJuz(juz) {
    const first = Object.keys(juz.verseMapping)
      .map(Number)
      .sort((a, b) => a - b)[0];
    if (!first) return;
    const from = String(juz.verseMapping[first]).split("-")[0];
    go(first, `${first}:${from}`);
  }

  const ayahChapter = chapterOf(ayahSurah);
  const maxAyah = ayahChapter ? ayahChapter.versesCount : 286;

  function submitAyah() {
    const s = ayahChapter ? ayahChapter.id : 1;
    const a = Math.min(maxAyah, Math.max(1, Number(ayahNum) || 1));
    go(s, `${s}:${a}`);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Browse the Quran"
        style={{
          bottom: kbInset || undefined,
          maxHeight: availH ? `${Math.round(availH * 0.92)}px` : undefined,
        }}
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[86dvh] w-full max-w-[560px] flex-col rounded-t-[24px] bg-white shadow-[0_-8px_24px_rgba(58,48,38,0.18)]"
      >
        {/* Everything above the list is flex-none, so it never scrolls away */}
        <div className="flex-none px-4 pt-3">
          <div className="mx-auto mb-3.5 h-1.5 w-11 rounded-pill bg-line" />

          <div className="mb-3.5 flex rounded-pill bg-paper-deep p-1" role="tablist">
            {[
              { key: "surah", label: "Surah" },
              { key: "juz", label: "Juz" },
              { key: "ayah", label: "Ayah" },
            ].map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                aria-selected={tab === t.key}
                onClick={() => setTab(t.key)}
                className={`flex-1 rounded-pill py-2 text-[13px] font-semibold transition-colors ${
                  tab === t.key ? "bg-ink text-paper shadow-sm" : "text-charcoal-soft"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {tab === "surah" && (
            <input
              type="search"
              placeholder="Search by name, or type 18:2"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key !== "Enter") return;
                if (typedRef) go(typedRef.chapter.id, `${typedRef.chapter.id}:${typedRef.ayah}`);
                else if (filteredChapters.length === 1) go(filteredChapters[0].id);
              }}
              className="mb-3 w-full rounded-control border-[0.5px] border-line bg-paper px-4 py-2.5 text-[15px] outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
            />
          )}
        </div>

        {/* min-h-0 is what lets this shrink inside the flex column — without it
            the list grows past the sheet and slides under the search field. */}
        {tab === "surah" && (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-4">
            {typedRef && (
              <button
                type="button"
                onClick={() => go(typedRef.chapter.id, `${typedRef.chapter.id}:${typedRef.ayah}`)}
                className="flex w-full items-center gap-3 rounded-card border-[0.5px] border-gold bg-gold-soft/40 px-3.5 py-3 text-left transition-colors hover:bg-gold-soft"
              >
                <span className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-gold text-ink">
                  <Icon name="chevron-right" size={16} />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-bold text-charcoal">
                    Go to {typedRef.chapter.nameSimple}, ayah {typedRef.ayah}
                  </span>
                  <span className="block text-[12px] text-charcoal-soft">
                    Surah {typedRef.chapter.id} · {typedRef.chapter.versesCount} ayahs
                  </span>
                </span>
              </button>
            )}

            {filteredChapters.length === 0 && !typedRef ? (
              <p className="py-8 text-center text-[13px] text-charcoal-soft">
                Nothing matches “{query}”.
              </p>
            ) : (
              filteredChapters.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => go(c.id)}
                  className="flex w-full items-center gap-3 rounded-card bg-paper px-3.5 py-3 text-left transition-colors hover:bg-paper-deep"
                >
                  <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-sage-soft text-[12px] font-bold text-sage">
                    {c.id}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] font-semibold text-charcoal">{c.nameSimple}</span>
                    <span className="block text-[12px] text-charcoal-soft">
                      {c.translatedName} · {c.versesCount} ayahs
                    </span>
                  </span>
                  <span className="font-arabic flex-none text-[20px] text-charcoal" lang="ar">
                    {c.nameArabic}
                  </span>
                </button>
              ))
            )}
          </div>
        )}

        {tab === "juz" && (
          <div className="min-h-0 flex-1 space-y-2 overflow-y-auto overscroll-contain px-4 pb-4">
            {state.juzs.map((j) => (
              <button
                key={j.number}
                type="button"
                onClick={() => goToJuz(j)}
                className="flex w-full items-center gap-3 rounded-card bg-paper px-3.5 py-3 text-left transition-colors hover:bg-paper-deep"
              >
                <span className="flex h-8 w-8 flex-none items-center justify-center rounded-full bg-sage-soft text-[12px] font-bold text-sage">
                  {j.number}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] font-semibold text-charcoal">Juz {j.number}</span>
                  <span className="block text-[12px] text-charcoal-soft">{juzLabel(j)}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {tab === "ayah" && (
          <div className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain px-4 pb-5">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-charcoal">Surah</span>
              <select
                value={ayahSurah}
                onChange={(e) => {
                  setAyahSurah(e.target.value);
                  setAyahNum("1");
                }}
                className="w-full rounded-control border-[0.5px] border-line bg-paper px-3.5 py-2.5 text-[15px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
              >
                {state.chapters.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.id}. {c.nameSimple}
                  </option>
                ))}
              </select>
            </label>

            <label className="block">
              <span className="mb-1.5 flex items-baseline justify-between text-[13px] font-semibold text-charcoal">
                Ayah
                <span className="font-normal text-charcoal-soft">1–{maxAyah}</span>
              </span>
              <input
                type="number"
                min="1"
                max={maxAyah}
                inputMode="numeric"
                value={ayahNum}
                onChange={(e) => setAyahNum(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && submitAyah()}
                className="w-full rounded-control border-[0.5px] border-line bg-paper px-3.5 py-2.5 text-[15px] outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
              />
            </label>

            <button
              type="button"
              onClick={submitAyah}
              className="w-full rounded-control bg-ink py-3 text-[14px] font-semibold text-paper transition-[background-color,transform] duration-150 ease-out hover:bg-ink-deep active:scale-[0.98]"
            >
              Go to {ayahChapter ? ayahChapter.nameSimple : "surah"} {Math.min(maxAyah, Math.max(1, Number(ayahNum) || 1))}
            </button>
          </div>
        )}
      </div>
    </>
  );
}
