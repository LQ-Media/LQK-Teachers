"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createDataSource } from "@/lib/quran/data";
import { createQuranStore } from "@/lib/quran/store";
import { createServerBookmarkService } from "@/lib/quran/bookmark-service";
import Icon from "@/components/Icon";
import VerseCard from "./VerseCard";
import BrowseSheet from "./BrowseSheet";
import DisplaySheet from "./DisplaySheet";
import MiniPlayer from "./MiniPlayer";

const BISMILLAH = "﷽"; // shown for every surah except 1 (it is ayah 1) and 9

function ayahNumberOf(verseKey) {
  return Number(String(verseKey).split(":")[1] || 0);
}

/**
 * Portal mount for the framework-agnostic Quran reader.
 *
 * `initialBookmark` is read server-side in the page (SQLite) and passed in so
 * the "continue reading" banner can render on first paint. The store then
 * re-reads it through the Server Action for cross-device freshness.
 */
export default function QuranReader({ initialBookmark = null }) {
  // Create store/services exactly once, via a lazy initializer so the value is
  // stable across renders and readable during render (unlike a ref). The store
  // guards `new Audio()` for SSR, so this is safe in the server render pass too.
  const [store] = useState(() =>
    createQuranStore({
      dataSource: createDataSource(),
      bookmarkService: createServerBookmarkService({ initialBookmark }),
      defaults: { chapterId: 1, translationId: 20, reciterId: 7, bookmark: initialBookmark },
    })
  );
  const state = useSyncExternalStore(store.subscribe, store.getState, store.getState);

  const [sheetOpen, setSheetOpen] = useState(false);
  const [displayOpen, setDisplayOpen] = useState(false);
  const [bannerDismissed, setBannerDismissed] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const scrollRef = useRef(null);
  const verseRefs = useRef(new Map());

  // Load saved display prefs on the client (kept out of the server render so
  // hydration stays deterministic), then boot the data.
  useEffect(() => {
    store.hydrate();
    store.init();
  }, [store]);

  // Jump to the focused verse (navigation target or bookmark resume) once
  // loaded. Instant scroll, plus one delayed re-scroll to absorb the layout
  // shift when the Amiri webfont finishes loading.
  useEffect(() => {
    if (state.versesStatus === "ready" && state.focusVerseKey) {
      const key = state.focusVerseKey;
      const jump = () => {
        const el = verseRefs.current.get(key);
        if (el) el.scrollIntoView({ behavior: "auto", block: "start" });
      };
      jump();
      const timer = setTimeout(jump, 700);
      store.clearFocus();
      return () => clearTimeout(timer);
    }
  }, [state.versesStatus, state.focusVerseKey, store]);

  // Keep the playing ayah in view during continuous playback — unless the
  // constant-speed auto-scroll is running, which owns the scroll position.
  useEffect(() => {
    if (state.autoscroll.active) return;
    if (state.playback.continuous && state.playback.verseKey) {
      const el = verseRefs.current.get(state.playback.verseKey);
      if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [state.playback.verseKey, state.playback.continuous, state.autoscroll.active]);

  // Hands-free constant-speed auto-scroll. Accumulate in a float because
  // element.scrollTop is integer-quantised and slow speeds would otherwise stall.
  useEffect(() => {
    if (!state.autoscroll.active) return;
    const el = scrollRef.current;
    if (!el) return;
    const pxPerSec = 12 + state.autoscroll.speed * 12; // ~24–132 px/s
    let raf = 0;
    let last = null;
    let acc = el.scrollTop;
    const tick = (t) => {
      if (last != null) {
        const dt = t - last;
        // Ignore long gaps (tab was hidden — rAF is paused there — or the loop
        // stalled) so refocusing never causes a sudden jump; just resync.
        if (dt > 0 && dt < 200) {
          acc += (pxPerSec * dt) / 1000;
          el.scrollTop = acc;
          if (el.scrollTop + el.clientHeight >= el.scrollHeight - 1) {
            store.setAutoscroll(false); // reached the end
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
    return () => cancelAnimationFrame(raf);
  }, [state.autoscroll.active, state.autoscroll.speed, store]);

  const onWordTap = useCallback((word) => {
    if (!word.meaning) return;
    setToast(
      <>
        <span className="font-arabic mr-2 text-[18px]" lang="ar">
          {word.text}
        </span>
        {word.meaning}
      </>
    );
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 2600);
  }, []);

  // One stable callback ref for every card (so memoised cards never re-render
  // on ref-identity churn). It reads the verse key from a data attribute and
  // returns a React 19 cleanup, keeping all ref access outside render.
  const registerCard = useCallback((el) => {
    const key = el.dataset.verseKey;
    verseRefs.current.set(key, el);
    return () => verseRefs.current.delete(key);
  }, []);

  if (state.status === "loading") {
    return <FullState>Loading the Quran…</FullState>;
  }

  if (state.status === "error") {
    return (
      <FullState>
        <p className="mb-4 text-[14px] text-charcoal">
          We could not load the Quran right now. Please check your connection.
        </p>
        <PrimaryButton onClick={() => store.init()}>Try again</PrimaryButton>
      </FullState>
    );
  }

  const chapter = store.chapterById(state.chapterId);
  const showContinue =
    !bannerDismissed && state.bookmark && Number(state.bookmark.chapterId) !== Number(state.chapterId);
  const continueChapter = showContinue
    ? state.chapters.find((c) => c.id === Number(state.bookmark.chapterId))
    : null;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-paper">
      {/* Header */}
      <header className="flex-none border-b-[0.5px] border-line bg-paper px-5 py-3">
        <div className="mx-auto flex max-w-[760px] flex-wrap items-center gap-3">
          <div>
            <h1 className="font-heading text-[20px] font-semibold text-charcoal">Quran</h1>
            <p className="text-[12px] text-charcoal-soft">Read and listen</p>
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="ml-auto rounded-control bg-ink px-4 py-2 text-[13px] font-semibold text-paper transition-colors hover:bg-ink-deep"
          >
            Browse
          </button>
          <div className="flex w-full items-center gap-3">
            <select
              aria-label="Translation language"
              value={state.translationId}
              onChange={(e) => store.setTranslationId(e.target.value)}
              className="min-w-0 flex-1 rounded-control border-[0.5px] border-line bg-white px-3 py-2 text-[13px] text-charcoal outline-none focus:border-ink focus:ring-[1.5px] focus:ring-ink"
            >
              {state.translations.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.languageName} — {t.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              onClick={() => setDisplayOpen(true)}
              className="flex flex-none items-center gap-2 rounded-control border-[0.5px] border-line bg-white px-3.5 py-2 text-[13px] font-semibold text-charcoal transition-colors hover:bg-paper-deep"
            >
              <Icon name="sliders" size={15} />
              Display
            </button>
          </div>
        </div>
      </header>

      {/* Banners */}
      {state.bookmarkError && (
        <Banner tone="error" onDismiss={() => store.dismissBookmarkError()}>
          {state.bookmarkError}
        </Banner>
      )}
      {continueChapter && (
        <Banner
          onDismiss={() => setBannerDismissed(true)}
          action={
            <PrimaryButton
              small
              onClick={() => {
                store.goTo(state.bookmark.chapterId, state.bookmark.verseKey);
                setBannerDismissed(true);
              }}
            >
              Resume
            </PrimaryButton>
          }
        >
          Continue reading —{" "}
          <strong className="font-semibold text-charcoal">
            Surah {continueChapter.nameSimple}, Ayah {ayahNumberOf(state.bookmark.verseKey)}
          </strong>
        </Banner>
      )}

      {/* Reading column (internal scroll — header and player stay pinned) */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[760px] px-5 py-6">
          {chapter && (
            <div className="mb-5 text-center">
              <h2 className="font-heading text-[24px] font-semibold text-charcoal">
                {chapter.id}. {chapter.nameSimple}
              </h2>
              <div className="font-arabic text-[28px] text-charcoal" lang="ar">
                {chapter.nameArabic}
              </div>
              <div className="mt-1 text-[13px] text-charcoal-soft">
                {chapter.translatedName} · {chapter.versesCount} ayahs
              </div>
              {chapter.id !== 1 && chapter.id !== 9 && (
                <div className="font-arabic mt-4 text-[26px] text-charcoal" lang="ar">
                  {BISMILLAH}
                </div>
              )}
            </div>
          )}

          {state.versesStatus === "loading" && <InlineState>Loading surah…</InlineState>}

          {state.versesStatus === "error" && (
            <InlineState>
              <p className="mb-4 text-[14px] text-charcoal">We could not load this surah. Please try again.</p>
              <PrimaryButton onClick={() => store.goTo(state.chapterId)}>Try again</PrimaryButton>
            </InlineState>
          )}

          {state.versesStatus === "ready" &&
            state.verses.map((v) => {
              const isCurrent = state.playback.verseKey === v.verseKey;
              return (
                <VerseCard
                  key={v.verseKey}
                  verse={v}
                  store={store}
                  displayMode={state.displayMode}
                  settings={state.settings}
                  showTransliteration={state.showTransliteration}
                  showTranslation={state.showTranslation}
                  isActive={isCurrent && state.playback.continuous}
                  isPlaying={isCurrent && (state.playback.playing || state.playback.loading)}
                  isBookmarked={!!state.bookmark && state.bookmark.verseKey === v.verseKey}
                  wordIndex={isCurrent ? state.playback.wordIndex : null}
                  onWordTap={onWordTap}
                  cardRef={registerCard}
                />
              );
            })}
        </div>
      </div>

      <MiniPlayer state={state} store={store} />

      {toast && (
        <div
          role="status"
          className="fixed bottom-24 left-1/2 z-50 max-w-[92vw] -translate-x-1/2 rounded-pill bg-charcoal px-5 py-2.5 text-center text-[14px] text-paper shadow-lg"
        >
          {toast}
        </div>
      )}

      {sheetOpen && <BrowseSheet state={state} store={store} onClose={() => setSheetOpen(false)} />}
      {displayOpen && <DisplaySheet state={state} store={store} onClose={() => setDisplayOpen(false)} />}
    </div>
  );
}

function Banner({ children, action, onDismiss, tone }) {
  return (
    <div className="flex-none px-5 pt-3">
      <div
        className={`mx-auto flex max-w-[760px] items-center gap-3 rounded-card border-[0.5px] px-4 py-3 text-[14px] ${
          tone === "error" ? "border-rust/30 bg-rust-soft text-rust" : "border-line bg-gold-soft/40 text-charcoal"
        }`}
      >
        <div className="flex-1">{children}</div>
        {action}
        <button
          type="button"
          aria-label="Dismiss"
          onClick={onDismiss}
          className="flex h-8 w-8 flex-none items-center justify-center rounded-full text-charcoal-soft hover:bg-black/5"
        >
          <Icon name="x" size={16} />
        </button>
      </div>
    </div>
  );
}

function PrimaryButton({ children, onClick, small }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`flex-none rounded-control bg-ink font-semibold text-paper transition-colors hover:bg-ink-deep ${
        small ? "px-4 py-1.5 text-[13px]" : "px-5 py-2.5 text-[14px]"
      }`}
    >
      {children}
    </button>
  );
}

function FullState({ children }) {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-paper px-5 text-center">
      <div>{children}</div>
    </div>
  );
}

function InlineState({ children }) {
  return <div className="py-12 text-center text-[14px] text-charcoal-soft">{children}</div>;
}
