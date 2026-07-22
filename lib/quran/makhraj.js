/**
 * Makhraj (مخارج الحروف) — articulation-point mapping, framework-agnostic.
 *
 * Makhraj is NOT provided by any Quran text API: it is a fixed linguistic
 * property of each letter, not of an ayah. So we map each Arabic consonant to
 * one of the five main articulation regions ourselves and colour letters by
 * region. This is a teaching aid, grouped at the level of the five points
 * (not all seventeen махārij), which is what colour-coding can usefully show.
 *
 * Regions:
 *   jawf      — الجوف     — oral/nasal cavity (the prolongation letters)
 *   halq      — الحلق     — throat (ء ه ع ح غ خ)
 *   lisan     — اللسان    — tongue (the largest group)
 *   shafatan  — الشفتان   — lips (ف ب م و)
 *   khayshoom — الخيشوم   — nasal passage (ghunnah of ن/م) — shown in the legend
 */

export const MAKHRAJ_REGIONS = {
  jawf: { label: "Jawf — cavity (madd)", arabic: "الجوف", color: "#C99A35" },
  halq: { label: "Halq — throat", arabic: "الحلق", color: "#B5573C" },
  lisan: { label: "Lisan — tongue", arabic: "اللسان", color: "#2E8B70" },
  shafatan: { label: "Shafatan — lips", arabic: "الشفتان", color: "#3B6FB0" },
  khayshoom: { label: "Khayshoom — nasal (ghunnah)", arabic: "الخيشوم", color: "#7A5AA8" },
};

// Base-letter → region. Consonantal articulation (و and ي are lips/tongue as
// consonants; as prolongation they belong to the jawf — noted in the legend).
const LETTER_REGION = {
  // Halq — throat
  "ء": "halq", "ه": "halq", "ع": "halq", "ح": "halq", "غ": "halq", "خ": "halq",
  // Shafatan — lips
  "ف": "shafatan", "ب": "shafatan", "م": "shafatan", "و": "shafatan",
  // Lisan — tongue (everything else)
  "ق": "lisan", "ك": "lisan", "ج": "lisan", "ش": "lisan", "ي": "lisan",
  "ض": "lisan", "ل": "lisan", "ن": "lisan", "ر": "lisan", "ط": "lisan",
  "د": "lisan", "ت": "lisan", "ص": "lisan", "ز": "lisan", "س": "lisan",
  "ظ": "lisan", "ذ": "lisan", "ث": "lisan",
  // Jawf — cavity (the pure madd letter)
  "ا": "jawf",
};

// Normalise letter variants to their base form before lookup.
const NORMALISE = {
  "أ": "ء", "إ": "ء", "آ": "ا", "ٱ": "ا", "ئ": "ء", "ؤ": "ء",
  "ة": "ت", // taa marbuta articulates as taa/haa; group with the tongue
  "ى": "ا", // alif maqsura — pronounced as a long 'aa'
  "ـ": null, // tatweel (kashida) — decorative, no articulation
};

// Arabic combining marks (harakat, shadda, sukoon, madda, superscript alef…).
// These must stay glued to the preceding base letter or the script breaks.
function isCombiningMark(ch) {
  const c = ch.codePointAt(0);
  return (
    (c >= 0x064b && c <= 0x065f) || // tanwin, harakat, shadda, sukoon…
    c === 0x0670 || // superscript alef
    (c >= 0x06d6 && c <= 0x06ed) // Quranic annotation signs
  );
}

function isArabicLetter(ch) {
  const c = ch.codePointAt(0);
  return c >= 0x0621 && c <= 0x064a;
}

/** Region key for a single base letter, or null if it has no mapping. */
export function makhrajOf(ch) {
  if (ch in NORMALISE) {
    const base = NORMALISE[ch];
    return base ? LETTER_REGION[base] || null : null;
  }
  return LETTER_REGION[ch] || null;
}

/**
 * Tokenise Arabic text into render units for makhraj colouring.
 * Each token is { text, region }: `region` is a key of MAKHRAJ_REGIONS when the
 * unit is a coloured letter (base letter + its attached marks), or null for
 * spaces / punctuation / unmapped glyphs that render in the base colour.
 */
export function tokeniseMakhraj(text) {
  const tokens = [];
  let current = null; // { text, region } for the letter being built

  const flush = () => {
    if (current) {
      tokens.push(current);
      current = null;
    }
  };

  for (const ch of String(text || "")) {
    if (isCombiningMark(ch)) {
      if (current) current.text += ch; // glue harakat onto the current letter
      else tokens.push({ text: ch, region: null });
      continue;
    }
    if (isArabicLetter(ch) || ch in NORMALISE) {
      flush();
      current = { text: ch, region: makhrajOf(ch) };
      continue;
    }
    // Space, digit, ayah marker, punctuation — plain.
    flush();
    tokens.push({ text: ch, region: null });
  }
  flush();
  return tokens;
}
