/**
 * On-device Quran cache — framework-agnostic, no Next/React code.
 *
 * Policy: network-first, cache-fallback. Whenever there is a connection the
 * API is the source of truth and every successful response is written through
 * to IndexedDB; when a request fails (or the device reports itself offline) the
 * saved copy is served instead. So the reader is always fresh online and still
 * opens on a plane or in a basement.
 *
 * Only text is stored — chapters, juz list, translations, reciters and the
 * per-surah verses (Arabic + translation + transliteration). Recitation audio
 * is deliberately excluded: a single reciter is hundreds of megabytes, which is
 * not something to put on a teacher's phone without asking.
 *
 * Nothing is bundled into the app: the cache only ever holds what the teacher's
 * own device fetched, so no translation is redistributed with the source.
 */

const DB_NAME = "lqk-quran-offline";
const DB_VERSION = 1;
const STORE = "kv";
const META_KEY = "meta:offline";
export const TOTAL_SURAHS = 114;

function hasIdb() {
  return typeof indexedDB !== "undefined";
}

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function tx(mode, run) {
  if (!hasIdb()) return undefined;
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = run(t.objectStore(STORE));
      t.onabort = () => reject(t.error);
      if (req) {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      } else {
        t.oncomplete = () => resolve(undefined);
      }
    });
  } finally {
    db.close();
  }
}

export function idbGet(key) {
  return tx("readonly", (s) => s.get(key));
}
export function idbSet(key, value) {
  return tx("readwrite", (s) => s.put(value, key));
}
export function idbKeys() {
  return tx("readonly", (s) => s.getAllKeys());
}
export function idbClearAll() {
  return tx("readwrite", (s) => s.clear());
}

/** The device says it is offline. Treated as a hint, never as the only check. */
function looksOffline() {
  return typeof navigator !== "undefined" && navigator.onLine === false;
}

/**
 * Network-first with a write-through cache and an offline fallback.
 * The cache write is fire-and-forget so a full quota never blocks reading.
 */
async function netFirst(key, loader) {
  if (looksOffline()) {
    const cached = await idbGet(key).catch(() => undefined);
    if (cached !== undefined) return cached;
  }
  try {
    const fresh = await loader();
    idbSet(key, fresh).catch(() => {});
    return fresh;
  } catch (err) {
    const cached = await idbGet(key).catch(() => undefined);
    if (cached !== undefined) return cached;
    throw err;
  }
}

const versesKey = (chapterId, translationId) => `verses:${chapterId}:${translationId}`;

/** Wraps a data source so every text read goes through the cache policy. */
export function withOfflineCache(source) {
  return {
    ...source,
    getChapters: () => netFirst("chapters", () => source.getChapters()),
    getJuzs: () => netFirst("juzs", () => source.getJuzs()),
    getTranslations: () => netFirst("translations", () => source.getTranslations()),
    getReciters: () => netFirst("reciters", () => source.getReciters()),
    getVerses: (chapterId, translationId) =>
      netFirst(versesKey(chapterId, translationId), () => source.getVerses(chapterId, translationId)),
    // Audio is never cached here — it stays a straight passthrough.
  };
}

/** How much of the Quran is saved for this translation. */
export async function offlineStatus(translationId) {
  if (!hasIdb()) return { supported: false, savedCount: 0, savedAt: null, translationId: null };
  try {
    const [keys, meta] = await Promise.all([idbKeys(), idbGet(META_KEY)]);
    const suffix = `:${translationId}`;
    const savedCount = (keys || []).filter(
      (k) => typeof k === "string" && k.startsWith("verses:") && k.endsWith(suffix)
    ).length;
    return {
      supported: true,
      savedCount,
      savedAt: meta?.savedAt ?? null,
      translationId: meta?.translationId ?? null,
    };
  } catch {
    return { supported: false, savedCount: 0, savedAt: null, translationId: null };
  }
}

/**
 * Fetch and store every surah for one translation.
 *
 * Four at a time: fast enough to finish in a couple of minutes on a phone
 * without hammering a free public API. Failures are counted, not fatal — a
 * partial copy still beats none, and a second run fills the gaps.
 */
export async function saveAllOffline(source, translationId, { onProgress, shouldStop } = {}) {
  const chapters = await source.getChapters();
  await Promise.all([
    idbSet("chapters", chapters),
    source.getJuzs().then((j) => idbSet("juzs", j)).catch(() => {}),
    source.getTranslations().then((t) => idbSet("translations", t)).catch(() => {}),
    source.getReciters().then((r) => idbSet("reciters", r)).catch(() => {}),
  ]);

  const queue = chapters.map((c) => c.id);
  let done = 0;
  let failed = 0;
  let stopped = false;

  async function worker() {
    for (;;) {
      if (shouldStop?.()) {
        stopped = true;
        return;
      }
      const id = queue.shift();
      if (id === undefined) return;
      try {
        const verses = await source.getVerses(id, translationId);
        await idbSet(versesKey(id, translationId), verses);
      } catch {
        failed += 1;
      }
      done += 1;
      onProgress?.(done, chapters.length);
    }
  }

  await Promise.all(Array.from({ length: 4 }, worker));
  await idbSet(META_KEY, {
    translationId,
    savedAt: new Date().toISOString(),
    count: chapters.length - failed,
  });
  return { done, failed, stopped, total: chapters.length };
}

export async function clearOffline() {
  await idbClearAll();
}

/** Rough size of the stored copy, when the browser will tell us. */
export async function offlineBytes() {
  try {
    const est = await navigator.storage?.estimate?.();
    return est?.usage ?? null;
  } catch {
    return null;
  }
}
