/**
 * Quran reader state store — framework-agnostic, no Next/React code.
 *
 * Ported unchanged from the LQK Shopify storefront reader. Owns: current
 * chapter/verses, translation + reciter selection, audio playback (single
 * ayah and continuous "play surah"), bookmark state. The UI layer subscribes
 * with store.subscribe(listener) and reads store.getState().
 *
 * Out of scope for v1 (do not build here): tafsir/commentary beyond the
 * API's inline data, and search within the Quran text.
 */

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
    showText: true, // one switch for transliteration + translation together
    focusVerseKey: null, // verse the UI should scroll to once (nav / bookmark jump)
    playback: {
      verseKey: null,
      playing: false,
      loading: false,
      continuous: false, // "Play surah" mode: auto-advance on ended
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

  // ---- Audio -------------------------------------------------------------
  // One shared HTMLAudioElement; continuous mode advances on `ended` using the
  // per-ayah audio endpoint — no chapter-level timestamp parsing needed.
  const audio = typeof Audio !== "undefined" ? new Audio() : null;
  let playToken = 0; // invalidates in-flight URL fetches when the user acts again

  if (audio) {
    audio.addEventListener("ended", () => {
      if (state.playback.continuous) {
        const moved = step(1, { keepContinuous: true });
        if (!moved) stopAudio();
      } else {
        setState({ playback: { ...state.playback, playing: false } });
      }
    });
    audio.addEventListener("error", () => {
      if (state.playback.loading || state.playback.playing) {
        setState({ playback: { ...state.playback, playing: false, loading: false } });
      }
    });
  }

  function stopAudio() {
    playToken += 1;
    if (audio) {
      audio.pause();
      audio.removeAttribute("src");
    }
    setState({ playback: { verseKey: null, playing: false, loading: false, continuous: false } });
  }

  async function playVerse(verseKey, { continuous } = {}) {
    if (!audio) return;
    const token = ++playToken;
    setState({ playback: { verseKey, playing: false, loading: true, continuous: !!continuous } });
    try {
      const url = await dataSource.getAudioUrl(state.reciterId, verseKey);
      if (token !== playToken) return; // superseded by a newer action
      audio.src = url;
      await audio.play();
      if (token !== playToken) return;
      setState({ playback: { verseKey, playing: true, loading: false, continuous: !!continuous } });
    } catch (err) {
      if (token !== playToken) return;
      setState({ playback: { verseKey, playing: false, loading: false, continuous: false } });
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
    setState({ chapterId: Number(chapterId), versesStatus: "loading", verses: [], focusVerseKey });
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
      // Only the audio URL depends on the reciter — never re-fetch verse text.
      if (wasPlaying && current) playVerse(current, { continuous });
    },
    toggleText() {
      setState({ showText: !state.showText });
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
