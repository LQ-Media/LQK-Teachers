// Icon assignments for the devotional library. Hand-mapped rather than
// generated: every collection inside a group gets a visually distinct shape,
// chosen to hint at the content (droplet for wudu, footprints for Sa'i,
// scissors for tahallul) so the cards are scannable without reading.
//
// Keys match CATALOG section keys exactly (see lib/dzikir/catalog.js).

// 3D clay renders for the five main headings (generated with Gemini, pastel
// rose + lavender, normalised to 512² white-ground tiles by hand). Keyed by
// CATALOG group key; the line icon below is the fallback and the small-size
// variant, since a 3D render turns to mush under about 28px.
export function groupImage(key) {
  return GROUP_ICONS[key] ? `/dzikir/${key}.png` : null;
}

// Line icons cycled for a collection's sub-sections. A collection can hold 35
// of them, so these repeat by design — they mark and separate the rows rather
// than identify each one, which the label already does.
const SUB_ICONS = [
  "scroll-text", "layers", "gem", "heart", "star", "sun", "moon", "droplet",
  "sparkles", "book-open", "feather", "crown", "flower", "hand-heart",
  "shield", "clock", "compass", "mic", "award", "book-marked",
];

export function subIcon(index) {
  return SUB_ICONS[index % SUB_ICONS.length];
}

export const GROUP_ICONS = {
  wirid: "sparkles",
  doa: "hand-heart",
  maulid: "flower",
  "haji-dan-umrah": "kaaba",
  spesial: "moon-star",
};

const SECTION_ICONS = {
  // Wirid & Zikir
  "wirid/dalailul-khairat": "scroll-text",
  "wirid/istighotsah-mujahadah": "shield",
  "wirid/ratib": "layers",
  "wirid/hizib": "gem",
  "wirid/shalawat": "heart",
  "wirid/munajat": "star",
  "wirid/wirid-harian": "sun",
  "wirid/manaqib-syekh-abdul-qadir": "award",

  // Doa
  "doa/doa-para-nabi-di-al-quran": "book-open",
  "doa/doa-shalat": "compass",
  "doa/doa-waktu-tertentu": "clock",
  "doa/doa-haji-umrah": "kaaba",
  "doa/doa-pernikahan-rumah-tangga": "heart",
  "doa/doa-baca-al-quran": "book-marked",
  "doa/doa-kematian": "moon",
  "doa/doa-wudhu": "droplet",
  "doa/doa-hamil-dan-persalinan": "baby",
  "doa/doa-keseharian": "sun",
  "doa/doa-tolak-bala": "shield",
  "doa/doa-ilmu": "graduation-cap",
  "doa/doa-kualitas-diri": "user",
  "doa/doa-rezeki": "coins",
  "doa/doa-perjalanan": "plane",
  "doa/doa-kesehatan": "heart-pulse",
  "other/uncat": "sparkles",

  // Maulid
  "maulid/syaraful-anam": "crown",
  "maulid/qasidah-burdah": "feather",
  "maulid/adl-dliyaul-lami": "sun",
  "maulid/maulid-al-azab": "star",
  "maulid/maulid-dibai": "moon-star",
  "maulid/maulid-simthud-duror": "gem",
  "maulid/maulidul-barzanji": "scroll-text",

  // Haji & Umrah
  "haji-dan-umrah/doa-saat-di-arafah": "mountain",
  "haji-dan-umrah/doa-tawaf": "refresh",
  "haji-dan-umrah/niat-ihram": "shirt",
  "haji-dan-umrah/doa-saat-di-madinah": "moon-star",
  "haji-dan-umrah/doa-setelah-shalat-sunnah": "house",
  "haji-dan-umrah/doa-sai": "footprints",
  "haji-dan-umrah/doa-saat-di-mina": "tent",
  "haji-dan-umrah/doa-saat-di-muzdalifah": "moon",
  "haji-dan-umrah/doa-saat-di-makkah": "kaaba",
  "haji-dan-umrah/doa-dalam-perjalanan": "plane",
  "haji-dan-umrah/bacaan-talbiyah-dan-shalawat": "mic",
  "haji-dan-umrah/doa-bercukur-tahallul": "scissors",
  "haji-dan-umrah/doa-tawaf-wada": "heart",

  // Ramadan
  "spesial/ramadhan": "moon-star",
};

export function groupIcon(key) {
  return GROUP_ICONS[key] || "book-open";
}

export function sectionIcon(key) {
  return SECTION_ICONS[key] || "book-open";
}
