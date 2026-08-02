/**
 * The Kalimah rotation — which ayah the whole centre studies on a given day.
 *
 * Only verse keys are listed here, never Arabic text or meanings: the words,
 * their glosses, transliteration and audio all come live from Quran.com, so
 * nothing in this repo can drift out of step with the mushaf, and no Arabic is
 * hand-authored (which is exactly where a well-meaning typo would do damage).
 *
 * The selection is deliberate rather than random. It is drawn almost entirely
 * from Juz 'Amma and Al-Fatihah — the surahs LQK children actually memorise —
 * so a teacher's own vocabulary study compounds directly into the classes they
 * teach. Everyone in the centre sees the same ayah on the same day, which is
 * what makes it something staff can talk about over lunch.
 */

const ROTATION = [
  // Al-Fatihah — the one every child starts with.
  "1:1", "1:2", "1:3", "1:4", "1:5", "1:6", "1:7",
  // Ayat al-Kursi and other widely recited ayat.
  "2:255", "2:286", "3:26", "112:1", "112:2", "112:3", "112:4",
  "113:1", "113:2", "113:3", "113:4", "113:5",
  "114:1", "114:2", "114:3", "114:4", "114:5", "114:6",
  // Juz 'Amma, shortest surahs first — the core hafazan syllabus.
  "108:1", "108:2", "108:3",
  "110:1", "110:2", "110:3",
  "111:1", "111:2", "111:3", "111:4", "111:5",
  "109:1", "109:2", "109:3", "109:4", "109:5", "109:6",
  "107:1", "107:2", "107:3", "107:4", "107:5", "107:6", "107:7",
  "106:1", "106:2", "106:3", "106:4",
  "105:1", "105:2", "105:3", "105:4", "105:5",
  "104:1", "104:2", "104:3", "104:4", "104:5", "104:6", "104:7", "104:8", "104:9",
  "103:1", "103:2", "103:3",
  "102:1", "102:2", "102:3", "102:4", "102:5", "102:6", "102:7", "102:8",
  "101:1", "101:2", "101:3", "101:4", "101:5", "101:6", "101:7", "101:8", "101:9", "101:10", "101:11",
  "100:1", "100:2", "100:3", "100:4", "100:5", "100:6", "100:7", "100:8", "100:9", "100:10", "100:11",
  "99:1", "99:2", "99:3", "99:4", "99:5", "99:6", "99:7", "99:8",
  "97:1", "97:2", "97:3", "97:4", "97:5",
  "94:1", "94:2", "94:3", "94:4", "94:5", "94:6", "94:7", "94:8",
  "93:1", "93:2", "93:3", "93:4", "93:5", "93:6", "93:7", "93:8", "93:9", "93:10", "93:11",
];

export const ROTATION_LENGTH = ROTATION.length;

/**
 * Days elapsed since a fixed epoch, in Singapore. Using a date string (not a
 * timestamp) keeps this stable regardless of the server's own timezone.
 */
function dayIndex(sgDateStr) {
  const [y, m, d] = String(sgDateStr).split("-").map(Number);
  const days = Date.UTC(y, (m || 1) - 1, d || 1) / 86_400_000;
  return Math.floor(days);
}

/** The verse key everyone studies on the given Singapore date. */
export function verseForDate(sgDateStr) {
  const idx = ((dayIndex(sgDateStr) % ROTATION_LENGTH) + ROTATION_LENGTH) % ROTATION_LENGTH;
  return ROTATION[idx];
}

/** Position in the cycle, for the "day N of M" read-out. */
export function positionForDate(sgDateStr) {
  const idx = ((dayIndex(sgDateStr) % ROTATION_LENGTH) + ROTATION_LENGTH) % ROTATION_LENGTH;
  return { day: idx + 1, total: ROTATION_LENGTH };
}
