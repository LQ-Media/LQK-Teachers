/**
 * Quran reader state store — framework-agnostic, no Next/React code.
 *
 * Ported from the LQK Shopify storefront reader. Owns: the reading layout
 * (ayah-by-ayah or mushaf page), current chapter/verses, translation + reciter
 * selection, audio playback (single ayah and continuous "play surah") with
 * word-level timing, bookmark state, and the reader's display preferences
 * (text visibility, Arabic script mode, per-layer text size + colour,
 * auto-scroll). The UI layer subscribes with store.subscribe(listener) and
 * reads store.getState().
 *
 * Display preferences persist to localStorage; call store.hydrate() from a
 * client effect after mount so the first (server) render stays deterministic.
 *
 * Out of scope (do not build here): tafsir/commentary beyond the API's inline
 * data, and search within the Quran text.
 */

// Explicit extensions so `node --test` can import this module directly, the
// same reason data.js carries them.
import {
  offlineStatus,
  saveAllOffline,
  clearOffline as clearOfflineStore,
  TOTAL_SURAHS,
} from "./offline.js";
import { PAGE_COUNT, chapterOfVerse, clampPage, firstVerseOfPage, pageOfVerse } from "./pages.js";

const PREFS_KEY = "lqk-quran-prefs";
// Bumped when a default changes that stored prefs would otherwise mask. v2:
// a much larger transliteration (13 -> 19px) and a slightly larger ayah.
const PREFS_VERSION = 2;

export const LAYOUTS = ["ayah", "page"];

export const DEFAULT_SETTINGS = {
  arabicSize: 30, // px
  translitSize: 19, // deliberately prominent — the line teachers read from
  translationSize: 15,
  arabicColor: "#3B372B", // charcoal
  translitColor: "#4E6B3E", // leaf green — the NU-Online-style latin line, in-palette
  translationColor: "#3B372B", // charcoal
};

export function createQuranStore({ dataSource, bookmarkService, readingLogService, defaults = {} }) {
  let state = {
    status: "loading", // 'loading' | 'ready' | 'error'
    error: null,
    chapters: [],
    juzs: [],
    translations: [],
    reciters: [],
    chapterId: defaults.chapterId || 1, // Al-Fatihah on first load
    verses: [],
    versesStatus: "loading", // chapter payload can reload independently of the shell
    // Mushaf page layout ------------------------------------------------------
    // 'ayah' is one card per verse (study); 'page' is the printed page of the
    // 604-page Madani mushaf (tilawah). Page numbers are only ever the API's.
    layout: LAYOUTS.includes(defaults.layout) ? defaults.layout : "ayah",
    pageNumber: 1,
    pageVerses: [],
    pageStatus: "loading",
    // -------------------------------------------------------------------------
    translationId: defaults.translationId || 20,
    reciterId: defaults.reciterId || 7,
    // Display preferences (persisted; see hydrate/persist below) --------------
    showTransliteration: true,
    showTranslation: true,
    displayMode: "plain", // Arabic script: 'plain' | 'tajweed' | 'makhraj'
    settings: { ...DEFAULT_SETTINGS },
    autoscroll: { active: false, speed: 3 }, // constant-speed reader; 1..10
    logToReading: false, // when on, bookmarking also logs a "Last read" entry
    readingLoggedAt: null, // ISO stamp the UI watches to confirm a log (toast)
    // -------------------------------------------------------------------------
    focusVerseKey: null, // verse the UI should scroll to once (nav / bookmark jump)
    playback: {
      verseKey: null,
      playing: false,
      loading: false,
      continuous: false, // "Play surah" mode: auto-advance on ended
      wordIndex: null, // 0-based index of the currently recited word (word sync)
      segments: null, // [{ word, start, end }] for the playing ayah | null
    },
    bookmark: defaults.bookmark || null, // { chapterId, verseKey } | null
    bookmarkSaving: false,
    bookmarkError: null,
    // On-device copy (see lib/quran/offline.js) ------------------------------
    offline: {
      supported: true,
      savedCount: 0, // surahs stored for the current translation
      total: TOTAL_SURAHS,
      savedAt: null,
      savedTranslationId: null,
      saving: false,
      progress: 0,
      error: null,
    },
  };

  const listeners = new Set();

  function setState(patch) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  }

  function chapterById(id) {
    return state.chapters.find((c) => c.id === Number(id)) || null;
  }

  /**
   * The verses on screen right now. Everything that walks "the next ayah" —
   * the mini player, continuous recitation, prev/next — reads this rather than
   * state.verses, so in page mode those controls step through the page the
   * teacher is looking at instead of a surah they are only part-way into.
   */
  function activeVerses() {
    return state.layout === "page" ? state.pageVerses : state.verses;
  }

  // ---- Preference persistence -------------------------------------------
  function persist() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          v: PREFS_VERSION,
          layout: state.layout,
          showTransliteration: state.showTransliteration,
          showTranslation: state.showTranslation,
          displayMode: state.displayMode,
          settings: state.settings,
          autoscrollSpeed: state.autoscroll.speed,
          logToReading: state.logToReading,
        })
      );
    } catch (err) {
      // Storage can be unavailable (private mode / quota) — prefs are best-effort.
    }
  }

  function hydrate() {
    if (typeof window === "undefined") return;
    try {
      const raw = window.localStorage.getItem(PREFS_KEY);
      if (!raw) return;
      const p = JSON.parse(raw);
      const patch = {};
      if (LAYOUTS.includes(p.layout)) patch.layout = p.layout;
      if (typeof p.showTransliteration === "boolean") patch.showTransliteration = p.showTransliteration;
      if (typeof p.showTranslation === "boolean") patch.showTranslation = p.showTranslation;
      if (["plain", "tajweed", "makhraj"].includes(p.displayMode)) patch.displayMode = p.displayMode;
      if (p.settings && typeof p.settings === "object") {
        // Stored prefs from before PREFS_VERSION keep their colours but take
        // the new sizes — otherwise a teacher who once touched the sliders
        // would never see a changed size default.
        const stored = p.v === PREFS_VERSION ? p.settings : omitSizes(p.settings);
        patch.settings = { ...DEFAULT_SETTINGS, ...stored };
      }
      if (Number.isFinite(p.autoscrollSpeed)) {
        patch.autoscroll = { ...state.autoscroll, speed: clampSpeed(p.autoscrollSpeed) };
      }
      if (typeof p.logToReading === "boolean") patch.logToReading = p.logToReading;
      if (Object.keys(patch).length) setState(patch);
    } catch (err) {
      // Ignore malformed stored prefs.
    }
  }

  function omitSizes(settings) {
    const { arabicSize, translitSize, translationSize, ...rest } = settings;
    return rest;
  }

  function clampSpeed(v) {
    return Math.min(10, Math.max(1, Math.round(Number(v) || 3)));
  }

  // ---- Audio -------------------------------------------------------------
  // One shared HTMLAudioElement; continuous mode advances on `ended` using the
  // per-chapter audio map (URL + word-timing segments), fetched once per
  // (reciter, chapter) and reused for playback and word-level highlighting.
  const audio = typeof Audio !== "undefined" ? new Audio() : null;
  let playToken = 0; // invalidates in-flight fetches when the user acts again
  let audioMap = null; // { verseKey: { url, segments } } for audioMapKey
  let audioMapKey = null; // `${reciterId}:${chapterId}`

  // Keyed by the chapter the VERSE belongs to, never by state.chapterId: a
  // mushaf page routinely ends one surah and starts the next, and asking for
  // Al-Falaq's recitation inside An-Nas's audio map returns nothing at all.
  async function ensureChapterAudio(reciterId, chapterId) {
    const key = `${reciterId}:${chapterId}`;
    if (audioMapKey === key && audioMap) return audioMap;
    const map = await dataSource.getChapterAudio(reciterId, chapterId);
    audioMap = map;
    audioMapKey = key;
    return map;
  }

  if (audio) {
    audio.addEventListener("ended", () => {
      if (state.playback.continuous) {
        if (!step(1)) {
          // Hold the playing state while the next page loads, so the player
          // doesn't flash back to "stopped" mid-recitation.
          continueOnNextPage().then((moved) => {
            if (!moved) stopAudio();
          });
        }
      } else {
        setState({ playback: { ...state.playback, playing: false, wordIndex: null } });
      }
    });
    audio.addEventListener("error", () => {
      if (state.playback.loading || state.playback.playing) {
        setState({ playback: { ...state.playback, playing: false, loading: false } });
      }
    });
    // Word-level sync: map the current playback position to a word index.
    audio.addEventListener("timeupdate", () => {
      const segs = state.playback.segments;
      if (!segs || !segs.length) return;
      const ms = audio.currentTime * 1000;
      let idx = -1;
      for (let i = 0; i < segs.length; i++) {
        if (ms >= segs[i].start) idx = i;
        else break;
      }
      const wordIndex = idx >= 0 ? segs[idx].word - 1 : null; // segments are 1-based
      if (wordIndex !== state.playback.wordIndex) {
        setState({ playback: { ...state.playback, wordIndex } });
      }
    });
  }

  function stopAudio() {
    playToken += 1;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    setState({
      playback: { verseKey: null, playing: false, loading: false, continuous: false, wordIndex: null, segments: null },
    });
  }

  async function playVerse(verseKey, { continuous } = {}) {
    if (!audio) return;
    const token = ++playToken;
    setState({
      playback: { verseKey, playing: false, loading: true, continuous: !!continuous, wordIndex: null, segments: null },
    });
    try {
      const map = await ensureChapterAudio(state.reciterId, chapterOfVerse(verseKey));
      if (token !== playToken) return; // superseded by a newer action
      const entry = map && map[verseKey];
      let url;
      let segments = null;
      if (entry && entry.url) {
        url = entry.url;
        segments = entry.segments;
      } else {
        url = await dataSource.getAudioUrl(state.reciterId, verseKey); // fallback, no timing
        if (token !== playToken) return;
      }
      audio.src = url;
      await audio.play();
      if (token !== playToken) return;
      setState({
        playback: { verseKey, playing: true, loading: false, continuous: !!continuous, wordIndex: null, segments },
      });
    } catch (err) {
      if (token !== playToken) return;
      setState({
        playback: { verseKey, playing: false, loading: false, continuous: false, wordIndex: null, segments: null },
      });
    }
  }

  /** Move playback ±1 ayah within what is on screen. Returns false at either edge. */
  function step(delta) {
    const list = activeVerses();
    const idx = list.findIndex((v) => v.verseKey === state.playback.verseKey);
    const next = idx === -1 ? (delta > 0 ? 0 : -1) : idx + delta;
    if (next < 0 || next >= list.length) return false;
    playVerse(list[next].verseKey, { continuous: state.playback.continuous });
    return true;
  }

  /**
   * Continuous recitation ran off the end of the page. Turn to the next one and
   * keep going, the way a teacher reciting a juz turns the page without
   * stopping. Only in page mode — in ayah mode the surah is the natural end.
   */
  async function continueOnNextPage() {
    if (state.layout !== "page" || state.pageNumber >= PAGE_COUNT) return false;
    const next = state.pageNumber + 1;
    await loadPage(next);
    const first = firstVerseOfPage(state.pageVerses);
    if (state.pageNumber !== next || !first) return false;
    playVerse(first, { continuous: true });
    return true;
  }

  // ---- Data loading ------------------------------------------------------

  async function init() {
    setState({ status: "loading", error: null });
    try {
      const [chapters, juzs, translations, reciters] = await Promise.all([
        dataSource.getChapters(),
        dataSource.getJuzs(),
        dataSource.getTranslations(),
        dataSource.getReciters(),
      ]);
      setState({ status: "ready", chapters, juzs, translations, reciters });
      // The surah is loaded either way: page mode still needs it to answer
      // "which page is this ayah on" when the teacher switches back.
      await loadChapter(state.chapterId, { focusVerseKey: state.focusVerseKey });
      if (state.layout === "page") await openPageForVerse(state.focusVerseKey);
      refreshBookmark();
      refreshOffline().catch(() => {});
    } catch (err) {
      setState({ status: "error", error: err.message || "Could not load the Quran data." });
    }
  }

  async function loadChapter(chapterId, { focusVerseKey = null } = {}) {
    stopAudio();
    setState({
      chapterId: Number(chapterId),
      versesStatus: "loading",
      verses: [],
      focusVerseKey,
      autoscroll: { ...state.autoscroll, active: false }, // fresh surah — don't keep scrolling
    });
    try {
      const verses = await dataSource.getVerses(Number(chapterId), state.translationId);
      if (state.chapterId !== Number(chapterId)) return; // user navigated away meanwhile
      setState({ versesStatus: "ready", verses });
    } catch (err) {
      if (state.chapterId !== Number(chapterId)) return;
      setState({ versesStatus: "error" });
    }
  }

  /** Load one printed page of the mushaf. */
  async function loadPage(pageNumber, { focusVerseKey = null } = {}) {
    const page = clampPage(pageNumber);
    setState({
      pageNumber: page,
      pageStatus: "loading",
      pageVerses: [],
      focusVerseKey,
      autoscroll: { ...state.autoscroll, active: false }, // fresh page — don't keep scrolling
    });
    try {
      const verses = await dataSource.getPage(page, state.translationId);
      if (state.pageNumber !== page) return; // turned the page again meanwhile
      setState({
        pageVerses: verses,
        pageStatus: "ready",
        // Keep the surah selectors and the mini player honest about what is on
        // screen: a page is titled by the surah it opens in.
        chapterId: verses.length ? Number(verses[0].chapterId) : state.chapterId,
      });
    } catch (err) {
      if (state.pageNumber !== page) return;
      setState({ pageStatus: "error" });
    }
  }

  /**
   * Open the page an ayah is printed on.
   *
   * The page number is always the API's: first from the loaded surah, and if
   * that surah was cached before page numbers were requested, by loading it
   * again. When even that comes back without one we stay where we are rather
   * than opening a page picked by arithmetic — a teacher told to read page 25
   * must not be shown page 24.
   */
  async function openPageForVerse(verseKey) {
    const key = verseKey || state.verses[0]?.verseKey || null;
    const known = key ? pageOfVerse(state.verses, key) : null;
    if (known) return loadPage(known, { focusVerseKey: key });

    const chapterId = key ? chapterOfVerse(key) : Number(state.chapterId);
    try {
      const verses = await dataSource.getVerses(chapterId, state.translationId);
      const page = pageOfVerse(verses, key) ?? Number(verses[0]?.page) ?? null;
      if (page) return loadPage(page, { focusVerseKey: key });
    } catch (err) {
      // fall through — handled below
    }
    // Nothing authoritative to go on. If a page is already open, leave it be.
    if (!state.pageVerses.length) setState({ pageStatus: "error" });
    return undefined;
  }

  // ---- Bookmark ----------------------------------------------------------

  async function refreshBookmark() {
    if (!bookmarkService || !bookmarkService.available) return;
    try {
      const bookmark = await bookmarkService.get();
      if (bookmark && bookmark.verseKey) setState({ bookmark });
    } catch (err) {
      // Keep whatever initial bookmark we were seeded with; reads are best-effort.
    }
  }

  // Remembers the last position auto-logged to My reading, so a double-tap on
  // the same ayah in one session doesn't append a duplicate entry. Re-reading
  // the same ayah in a later session (a fresh store) still logs, as intended.
  let lastLoggedKey = null;

  async function maybeLogReading(pos) {
    if (!state.logToReading || !readingLogService) return;
    const key = `${pos.chapterId}:${pos.verseKey}`;
    if (key === lastLoggedKey) return;
    lastLoggedKey = key;
    try {
      await readingLogService.log(pos);
      setState({ readingLoggedAt: new Date().toISOString() });
    } catch (err) {
      // Best-effort — the bookmark itself already saved; don't surface noise.
      lastLoggedKey = null; // allow a retry on the next tap
    }
  }

  async function setBookmark(verseKey) {
    if (!bookmarkService || !bookmarkService.available) return;
    const pos = { chapterId: state.chapterId, verseKey };
    const previous = state.bookmark;
    setState({ bookmark: pos, bookmarkSaving: true, bookmarkError: null });
    try {
      await bookmarkService.set(pos);
      setState({ bookmarkSaving: false });
      maybeLogReading(pos);
    } catch (err) {
      setState({
        bookmark: previous,
        bookmarkSaving: false,
        bookmarkError: "Could not save your bookmark. Please try again.",
      });
    }
  }

  // ---- On-device copy ----------------------------------------------------
  // The download runs in the UI's lifetime, not the store's, so a stop flag
  // lives here and the worker pool polls it between surahs.
  let stopOffline = false;

  async function refreshOffline() {
    const s = await offlineStatus(state.translationId);
    setState({
      offline: {
        ...state.offline,
        supported: s.supported,
        savedCount: s.savedCount,
        savedAt: s.savedAt,
        savedTranslationId: s.translationId,
      },
    });
  }

  // ---- Public API ---------------------------------------------------------

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState() {
      return state;
    },
    chapterById,
    init,
    hydrate,

    /**
     * Go to a surah (and optionally an ayah within it). Works from either
     * layout: the surah dropdown, the juz jump and the bookmark banner all
     * come through here, and in page mode they turn to the page that ayah is
     * printed on instead of leaving the teacher on the page they were reading.
     */
    goTo(chapterId, verseKey = null) {
      const target = verseKey || `${Number(chapterId)}:1`;
      const loaded = loadChapter(chapterId, { focusVerseKey: verseKey });
      if (state.layout === "page") loaded.then(() => openPageForVerse(target));
    },
    clearFocus() {
      if (state.focusVerseKey) setState({ focusVerseKey: null });
    },

    // ---- Mushaf page layout ----
    setLayout(layout) {
      if (!LAYOUTS.includes(layout) || layout === state.layout) return;
      stopAudio();
      setState({ layout });
      persist();

      if (layout === "page") {
        // Open on whatever the teacher was last looking at, in this order:
        // the ayah being recited, the one they navigated to, their bookmark in
        // this surah, else the top of the surah.
        const here =
          state.playback.verseKey ||
          state.focusVerseKey ||
          (state.bookmark && Number(state.bookmark.chapterId) === Number(state.chapterId)
            ? state.bookmark.verseKey
            : null);
        openPageForVerse(here);
        return;
      }

      // Back to ayah mode: land on the first ayah of the page just read, so
      // the eye picks up exactly where it left off.
      const first = firstVerseOfPage(state.pageVerses);
      if (first) loadChapter(chapterOfVerse(first), { focusVerseKey: first });
    },
    goToPage(pageNumber) {
      loadPage(pageNumber);
    },
    nextPage() {
      if (state.pageNumber < PAGE_COUNT) loadPage(state.pageNumber + 1);
    },
    prevPage() {
      if (state.pageNumber > 1) loadPage(state.pageNumber - 1);
    },
    retryPage() {
      loadPage(state.pageNumber);
    },

    setTranslationId(id) {
      state.translationId = Number(id); // applied by the reload below
      setState({ translationId: Number(id) });
      loadChapter(state.chapterId);
      if (state.layout === "page") loadPage(state.pageNumber);
      refreshOffline().catch(() => {}); // the saved copy is per-translation
    },
    setReciterId(id) {
      const wasPlaying = state.playback.playing || state.playback.loading;
      const current = state.playback.verseKey;
      const continuous = state.playback.continuous;
      setState({ reciterId: Number(id) });
      // Only the audio (URL + timing) depends on the reciter — never re-fetch
      // verse text. ensureChapterAudio refetches because the map key changed.
      if (wasPlaying && current) playVerse(current, { continuous });
    },

    // ---- Display preferences ----
    toggleTransliteration() {
      setState({ showTransliteration: !state.showTransliteration });
      persist();
    },
    toggleTranslation() {
      setState({ showTranslation: !state.showTranslation });
      persist();
    },
    setDisplayMode(mode) {
      if (!["plain", "tajweed", "makhraj"].includes(mode)) return;
      setState({ displayMode: mode });
      persist();
    },
    setSetting(key, value) {
      if (!(key in state.settings)) return;
      setState({ settings: { ...state.settings, [key]: value } });
      persist();
    },
    resetSettings() {
      setState({ settings: { ...DEFAULT_SETTINGS } });
      persist();
    },

    // ---- Auto-scroll (constant-speed reader; the UI runs the scroll loop) ----
    toggleAutoscroll() {
      setState({ autoscroll: { ...state.autoscroll, active: !state.autoscroll.active } });
    },
    setAutoscroll(active) {
      setState({ autoscroll: { ...state.autoscroll, active: !!active } });
    },
    setAutoscrollSpeed(speed) {
      setState({ autoscroll: { ...state.autoscroll, speed: clampSpeed(speed) } });
      persist();
    },

    togglePlay(verseKey) {
      const p = state.playback;
      if (p.verseKey === verseKey && (p.playing || p.loading)) {
        if (audio) audio.pause();
        playToken += 1;
        setState({ playback: { ...p, playing: false, loading: false } });
      } else if (p.verseKey === verseKey && !p.playing && audio && audio.src) {
        audio.play();
        setState({ playback: { ...p, playing: true, continuous: p.continuous } });
      } else {
        playVerse(verseKey, { continuous: false });
      }
    },
    /** Recite from here to the end — of the page in page mode, of the surah otherwise. */
    playChapter() {
      const list = activeVerses();
      if (list.length === 0) return;
      const from = state.playback.verseKey || list[0].verseKey;
      playVerse(from, { continuous: true });
    },
    pause() {
      if (audio) audio.pause();
      playToken += 1;
      setState({ playback: { ...state.playback, playing: false, loading: false } });
    },
    resumeOrPlayChapter() {
      const p = state.playback;
      if (p.verseKey && !p.playing && audio && audio.src) {
        audio.play();
        setState({ playback: { ...p, playing: true } });
      } else {
        this.playChapter();
      }
    },
    next() {
      step(1);
    },
    prev() {
      step(-1);
    },
    stop: stopAudio,

    setBookmark,
    dismissBookmarkError() {
      setState({ bookmarkError: null });
    },

    toggleLogToReading() {
      setState({ logToReading: !state.logToReading });
      persist();
    },

    // ---- On-device copy ----
    refreshOffline,

    async saveOffline() {
      if (state.offline.saving) return;
      stopOffline = false;
      setState({ offline: { ...state.offline, saving: true, progress: 0, error: null } });
      try {
        const res = await saveAllOffline(dataSource, state.translationId, {
          onProgress: (done) => setState({ offline: { ...state.offline, progress: done } }),
          shouldStop: () => stopOffline,
        });
        setState({
          offline: {
            ...state.offline,
            saving: false,
            error:
              res.failed > 0
                ? `${res.failed} surah${res.failed === 1 ? "" : "s"} could not be saved. Tap save again to fill the gaps.`
                : null,
          },
        });
      } catch (err) {
        setState({
          offline: {
            ...state.offline,
            saving: false,
            error: "Could not save the Quran. Check your connection and try again.",
          },
        });
      }
      await refreshOffline();
    },

    stopSavingOffline() {
      stopOffline = true;
    },

    async clearOffline() {
      await clearOfflineStore().catch(() => {});
      await refreshOffline();
    },
  };
}
