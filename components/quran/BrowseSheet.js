"use client";

import { useMemo, useState } from "react";

export default function BrowseSheet({ state, store, onClose }) {
  const [tab, setTab] = useState("surah");
  const [query, setQuery] = useState("");
  const [ayahSurah, setAyahSurah] = useState(String(state.chapterId));
  const [ayahNum, setAyahNum] = useState("1");

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

  function juzLabel(juz) {
    const chapterIds = Object.keys(juz.verseMapping)
      .map(Number)
      .sort((a, b) => a - b);
    return chapterIds
      .map((id) => {
        const c = state.chapters.find((ch) => ch.id === id);
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

  function submitAyah() {
    const s = Math.min(114, Math.max(1, Number(ayahSurah) || 1));
    const chapter = state.chapters.find((c) => c.id === s);
    const maxAyah = chapter ? chapter.versesCount : 286;
    const a = Math.min(maxAyah, Math.max(1, Number(ayahNum) || 1));
    go(s, `${s}:${a}`);
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-charcoal/40" onClick={onClose} />
      <div
        role="dialog"
        aria-label="Browse the Quran"
        className="fixed inset-x-0 bottom-0 z-50 mx-auto flex max-h-[82vh] w-full max-w-[560px] flex-col rounded-t-[24px] bg-white p-4 shadow-[0_-8px_24px_rgba(58,48,38,0.18)]"
      >
        <div className="mx-auto mb-3.5 h-1.5 w-11 rounded-pill bg-line" />

        <div className="mb-3.5 flex rounded-pill bg-paper-deep p-1" role="tablist">
          {["surah", "juz", "ayah"].map((t) => (
            <button
              key={t}
              type="button"
              role="tab"
              aria-selected={tab === t}
              onClick={() => setTab(t)}
              className={`flex-1 rounded-pill py-2 text-[13px] font-semibold capitalize transition-colors ${
                tab === t ? "bg-ink text-paper shadow-sm" : "text-charcoal-soft"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === "surah" && (
          <>
            <input
              type="search"
              placeholder="Search by name or number"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="mb-3 rounded-control border-[0.5px] border-line bg-paper px-4 py-2.5 text-[14px] outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
            />
            <div className="flex-1 space-y-2 overflow-y-auto">
              {filteredChapters.map((c) => (
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
              ))}
            </div>
          </>
        )}

        {tab === "juz" && (
          <div className="flex-1 space-y-2 overflow-y-auto">
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
          <div className="space-y-3 px-0.5 py-2">
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-charcoal">
                Surah <span className="font-normal text-charcoal-soft">(1–114)</span>
              </span>
              <input
                type="number"
                min="1"
                max="114"
                inputMode="numeric"
                value={ayahSurah}
                onChange={(e) => setAyahSurah(e.target.value)}
                className="w-full rounded-control border-[0.5px] border-line bg-paper px-3.5 py-2.5 text-[15px] outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
              />
            </label>
            <label className="block">
              <span className="mb-1.5 block text-[13px] font-semibold text-charcoal">Ayah</span>
              <input
                type="number"
                min="1"
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
              className="w-full rounded-control bg-ink py-2.5 text-[14px] font-semibold text-paper transition-colors hover:bg-ink-deep"
            >
              Go
            </button>
          </div>
        )}
      </div>
    </>
  );
}
