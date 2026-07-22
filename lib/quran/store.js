/**
 * Quran reader state store — framework-agnostic, no Next/React code.
 *
 * Ported from the LQK Shopify storefront reader. Owns: current chapter/verses,
 * translation + reciter selection, audio playback (single ayah and continuous
 * "play surah") with word-level timing, bookmark state, and the reader's
 * display preferences (text visibility, Arabic script mode, per-layer text
 * size + colour, auto-scroll). The UI layer subscribes with
 * store.subscribe(listener) and reads store.getState().
 *
 * Display preferences persist to localStorage; call store.hydrate() from a
 * client effect after mount so the first (server) render stays deterministic.
 *
 * Out of scope (do not build here): tafsir/commentary beyond the API's inline
 * data, and search within the Quran text.
 */

const PREFS_KEY = "lqk-quran-prefs";

export const DEFAULT_SETTINGS = {
  arabicSize: 30, // px
  translitSize: 13,
  translationSize: 14,
  arabicColor: "#3A3026", // charcoal
  translitColor: "#7A6E5C", // charcoal-soft
  translationColor: "#3A3026", // charcoal
};

export function createQuranStore({ dataSource, bookmarkService, defaults = {} }) {
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
    translationId: defaults.translationId || 20,
    reciterId: defaults.reciterId || 7,
    // Display preferences (persisted; see hydrate/persist below) --------------
    showTransliteration: true,
    showTranslation: true,
    displayMode: "plain", // Arabic script: 'plain' | 'tajweed' | 'makhraj'
    settings: { ...DEFAULT_SETTINGS },
    autoscroll: { active: false, speed: 3 }, // constant-speed reader; 1..10
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
  };

  const listeners = new Set();

  function setState(patch) {
    state = { ...state, ...patch };
    listeners.forEach((l) => l());
  }

  function chapterById(id) {
    return state.chapters.find((c) => c.id === Number(id)) || null;
  }

  // ---- Preference persistence -------------------------------------------
  function persist() {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(
        PREFS_KEY,
        JSON.stringify({
          showTransliteration: state.showTransliteration,
          showTranslation: state.showTranslation,
          displayMode: state.displayMode,
          settings: state.settings,
          autoscrollSpeed: state.autoscroll.speed,
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
      if (typeof p.showTransliteration === "boolean") patch.showTransliteration = p.showTransliteration;
      if (typeof p.showTranslation === "boolean") patch.showTranslation = p.showTranslation;
      if (["plain", "tajweed", "makhraj"].includes(p.displayMode)) patch.displayMode = p.displayMode;
      if (p.settings && typeof p.settings === "object") {
        patch.settings = { ...DEFAULT_SETTINGS, ...p.settings };
      }
      if (Number.isFinite(p.autoscrollSpeed)) {
        patch.autoscroll = { ...state.autoscroll, speed: clampSpeed(p.autoscrollSpeed) };
      }
      if (Object.keys(patch).length) setState(patch);
    } catch (err) {
      // Ignore malformed stored prefs.
    }
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
        const moved = step(1, { keepContinuous: true });
        if (!moved) stopAudio();
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
      const map = await ensureChapterAudio(state.reciterId, state.chapterId);
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

  /** Move playback ±1 ayah within the current chapter. Returns false at either edge. */
  function step(delta, { keepContinuous } = {}) {
    const idx = state.verses.findIndex((v) => v.verseKey === state.playback.verseKey);
    const next = idx === -1 ? (delta > 0 ? 0 : -1) : idx + delta;
    if (next < 0 || next >= state.verses.length) return false;
    const continuous = keepContinuous ? state.playback.continuous : state.playback.continuous;
    playVerse(state.verses[next].verseKey, { continuous });
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
      await loadChapter(state.chapterId, { focusVerseKey: state.focusVerseKey });
      refreshBookmark();
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

  async function setBookmark(verseKey) {
    if (!bookmarkService || !bookmarkService.available) return;
    const pos = { chapterId: state.chapterId, verseKey };
    const previous = state.bookmark;
    setState({ bookmark: pos, bookmarkSaving: true, bookmarkError: null });
    try {
      await bookmarkService.set(pos);
      setState({ bookmarkSaving: false });
    } catch (err) {
      setState({
        bookmark: previous,
        bookmarkSaving: false,
        bookmarkError: "Could not save your bookmark. Please try again.",
      });
    }
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

    goTo(chapterId, verseKey = null) {
      loadChapter(chapterId, { focusVerseKey: verseKey });
    },
    clearFocus() {
      if (state.focusVerseKey) setState({ focusVerseKey: null });
    },

    setTranslationId(id) {
      state.translationId = Number(id); // applied by the reload below
      setState({ translationId: Number(id) });
      loadChapter(state.chapterId);
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
    playChapter() {
      if (state.verses.length === 0) return;
      const from = state.playback.verseKey || state.verses[0].verseKey;
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
  };
}
