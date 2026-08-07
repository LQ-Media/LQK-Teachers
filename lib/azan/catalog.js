// Azan sound catalog + settings shape, shared by client and server (plain
// data, no server-only imports). Bundled files live in /public/azan; their
// provenance and licences are in /public/azan/CREDITS.md.

export const PRAYER_KEYS = ["Fajr", "Dhuhr", "Asr", "Maghrib", "Isha"];

export const PRAYER_LABELS = {
  Fajr: "Subuh",
  Dhuhr: "Zohor",
  Asr: "Asar",
  Maghrib: "Maghrib",
  Isha: "Isyak",
};

export const PRAYER_ICONS = {
  Fajr: "sunrise",
  Dhuhr: "sun",
  Asr: "cloud-sun",
  Maghrib: "sunset",
  Isha: "moon-star",
};

export const BUNDLED_SOUNDS = [
  {
    id: "makkah",
    label: "Makkah — Masjid al-Haram",
    src: "/azan/azan-makkah.mp3",
    duration: 197,
    credit: "Adhan at the Great Mosque of Mecca (2013), Mohammed Tawsif Salam — CC BY 3.0, Wikimedia Commons",
  },
  {
    id: "makkah-maghrib",
    label: "Makkah — Maghrib, Masjid al-Haram",
    src: "/azan/azan-makkah-maghrib.mp3",
    duration: 301,
    credit: "Maghrib Adhan at the Masjid al-Haram (2012), Mohammed Tawsif Salam — CC BY 3.0, Wikimedia Commons",
  },
  {
    id: "studio",
    label: "Studio azan — Aaqib Azeez",
    src: "/azan/azan-studio.mp3",
    duration: 87,
    credit: "The Adhan — Muslim Call to Prayer, Aaqib Azeez — CC BY-SA 4.0, Wikimedia Commons",
  },
  {
    id: "classic",
    label: "Classic recitation",
    src: "/azan/azan-classic.mp3",
    duration: 210,
    credit: "Islamic call to worship — CC BY-SA 4.0, Wikimedia Commons",
  },
  {
    id: "fajr",
    label: "Azan Subuh (Fajr)",
    src: "/azan/azan-fajr.mp3",
    duration: 248,
    fajrOnly: true,
    credit: "Fajr azan at Malmö Mosque (2012) — CC BY 3.0, Wikimedia Commons",
  },
  {
    id: "chime",
    label: "Soft chime (short reminder)",
    src: "/azan/chime.mp3",
    duration: 7,
    credit: null,
  },
];

export const BUNDLED_BY_ID = Object.fromEntries(BUNDLED_SOUNDS.map((s) => [s.id, s]));

// Every prayer starts OFF (auto-playing sound is strictly opt-in); the Fajr
// slot defaults to the dedicated Subuh azan, the rest to the Makkah recording.
export function defaultPrayers() {
  const prayers = {};
  for (const key of PRAYER_KEYS) {
    prayers[key] = { enabled: false, sound: key === "Fajr" ? "fajr" : "makkah" };
  }
  return prayers;
}

export function isCustomSoundId(id) {
  return typeof id === "string" && id.startsWith("custom:");
}

/** The <audio> src for a sound id — bundled path or the custom-upload route. */
export function soundSrc(id) {
  if (isCustomSoundId(id)) return `/api/azan/audio/${encodeURIComponent(id.slice(7))}`;
  return BUNDLED_BY_ID[id]?.src || BUNDLED_BY_ID.makkah.src;
}

/**
 * Clamp a client-supplied prayers object to the known shape. `customIds` is
 * the set of upload ids the user actually owns — anything else falls back to
 * the default sound so a stale/foreign id can never be stored.
 */
export function sanitizePrayers(input, customIds = new Set()) {
  const clean = defaultPrayers();
  if (!input || typeof input !== "object") return clean;
  for (const key of PRAYER_KEYS) {
    const p = input[key];
    if (!p || typeof p !== "object") continue;
    clean[key].enabled = !!p.enabled;
    const sound = p.sound;
    if (typeof sound === "string") {
      if (BUNDLED_BY_ID[sound]) clean[key].sound = sound;
      else if (isCustomSoundId(sound) && customIds.has(sound.slice(7))) clean[key].sound = sound;
    }
  }
  return clean;
}
