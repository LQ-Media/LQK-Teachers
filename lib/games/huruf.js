/**
 * The 28 huruf, exactly as the LQK flashcard deck teaches them.
 *
 * Transcribed from Flashcards_Fatha_Kasra_Domma_Print_all.pptx — the deck order
 * (two slides per letter: positional forms, then the three harakat), the deck's
 * letter names, and above all the deck's TRANSLITERATIONS, which are not
 * decorative. They encode tafkhim: the heavy letters take an "o" on fatha, so
 * ق is Qo and not Qa, ط is Tho, ص is Sho, ر is Ro. A generic a/i/u table would
 * quietly teach the wrong vowel on eight of the 28 letters, so the labels are
 * data here rather than something derived from the letter.
 *
 * `id` is the key everything else hangs off: the geometry in
 * public/huruf/geometry.json, and the audio filenames under
 * public/huruf/audio/ (see scripts/generate-huruf-audio.mjs).
 */

export const FATHA = "َ";
export const KASRA = "ِ";
export const DAMMA = "ُ";

export const HARAKAT = [
  { id: "fatha", mark: FATHA, name: "Fatha", above: true, vowel: "a" },
  { id: "kasra", mark: KASRA, name: "Kasra", above: false, vowel: "i" },
  { id: "damma", mark: DAMMA, name: "Damma", above: true, vowel: "u" },
];

/* Each letter: id, isolated char, the deck's name, the three positional forms
   as shown on the letter's first slide, and the three harakat labels as shown
   on its second slide in fatha / kasra / damma order. */
export const HURUF = [
  { id: "alif", char: "ا", name: "Alif", forms: ["ا", "ـا", "ـا"], say: ["A", "I", "U"] },
  { id: "ba", char: "ب", name: "Ba", forms: ["بـ", "ـبـ", "ـب"], say: ["Ba", "Bi", "Bu"] },
  { id: "ta", char: "ت", name: "Ta", forms: ["تـ", "ـتـ", "ـت"], say: ["Ta", "Ti", "Tu"] },
  { id: "tsa", char: "ث", name: "Tsa", forms: ["ثـ", "ـثـ", "ـث"], say: ["Tsa", "Tsi", "Tsu"] },
  { id: "jim", char: "ج", name: "Jim", forms: ["جـ", "ـجـ", "ـج"], say: ["Ja", "Ji", "Ju"] },
  { id: "ha", char: "ح", name: "Ha", forms: ["حـ", "ـحـ", "ـح"], say: ["Ha", "Hi", "Hu"] },
  { id: "kho", char: "خ", name: "Kho", forms: ["خـ", "ـخـ", "ـخ"], say: ["Kho", "Khi", "Khu"] },
  { id: "dal", char: "د", name: "Dal", forms: ["د", "ـد", "ـد"], say: ["Da", "Di", "Du"] },
  { id: "dzal", char: "ذ", name: "Dzal", forms: ["ذ", "ـذ", "ـذ"], say: ["Dza", "Dzi", "Dzu"] },
  { id: "ro", char: "ر", name: "Ro", forms: ["ر", "ـر", "ـر"], say: ["Ro", "Ri", "Ru"] },
  { id: "zay", char: "ز", name: "Zay", forms: ["ز", "ـز", "ـز"], say: ["Za", "Zi", "Zu"] },
  { id: "sin", char: "س", name: "Sin", forms: ["سـ", "ـسـ", "ـس"], say: ["Sa", "Si", "Su"] },
  { id: "syin", char: "ش", name: "Syin", forms: ["شـ", "ـشـ", "ـش"], say: ["Sya", "Syi", "Syu"] },
  { id: "shod", char: "ص", name: "Shod", forms: ["صـ", "ـصـ", "ـص"], say: ["Sho", "Shi", "Shu"] },
  { id: "dhod", char: "ض", name: "Dhod", forms: ["ضـ", "ـضـ", "ـض"], say: ["Dho", "Dhi", "Dhu"] },
  { id: "tho", char: "ط", name: "Tho", forms: ["طـ", "ـطـ", "ـط"], say: ["Tho", "Thi", "Thu"] },
  { id: "zho", char: "ظ", name: "Zho", forms: ["ظـ", "ـظـ", "ـظ"], say: ["Zho", "Zhi", "Zhu"] },
  { id: "ain", char: "ع", name: "‘Ain", forms: ["عـ", "ـعـ", "ـع"], say: ["‘A", "‘I", "‘U"] },
  { id: "ghoin", char: "غ", name: "Ghoin", forms: ["غـ", "ـغـ", "ـغ"], say: ["Gho", "Ghi", "Ghu"] },
  { id: "fa", char: "ف", name: "Fa", forms: ["فـ", "ـفـ", "ـف"], say: ["Fa", "Fi", "Fu"] },
  { id: "qof", char: "ق", name: "Qof", forms: ["قـ", "ـقـ", "ـق"], say: ["Qo", "Qi", "Qu"] },
  { id: "kaf", char: "ك", name: "Kaf", forms: ["كـ", "ـكـ", "ـك"], say: ["Ka", "Ki", "Ku"] },
  { id: "lam", char: "ل", name: "Lam", forms: ["لـ", "ـلـ", "ـل"], say: ["La", "Li", "Lu"] },
  { id: "mim", char: "م", name: "Mim", forms: ["مـ", "ـمـ", "ـم"], say: ["Ma", "Mi", "Mu"] },
  { id: "nun", char: "ن", name: "Nun", forms: ["نـ", "ـنـ", "ـن"], say: ["Na", "Ni", "Nu"] },
  { id: "hha", char: "ه", name: "Ha", forms: ["هـ", "ـهـ", "ـه"], say: ["Ha", "Hi", "Hu"] },
  { id: "wau", char: "و", name: "Wau", forms: ["و", "ـو", "ـو"], say: ["Wa", "Wi", "Wu"] },
  { id: "ya", char: "ي", name: "Ya", forms: ["يـ", "ـيـ", "ـي"], say: ["Ya", "Yi", "Yu"] },
];

export const FORM_LABELS = ["Initial", "Medial", "Final"];

const BY_ID = new Map(HURUF.map((h) => [h.id, h]));

export function huruf(id) {
  return BY_ID.get(id) ?? null;
}

/** The letter written with one harakah, e.g. ("ba", "kasra") → "بِ". */
export function withHarakah(letter, harakahId) {
  const h = HARAKAT.find((x) => x.id === harakahId);
  return h ? letter.char + h.mark : letter.char;
}

/** The deck's transliteration for one letter + harakah, e.g. "Qi". */
export function sayFor(letter, harakahId) {
  const i = HARAKAT.findIndex((x) => x.id === harakahId);
  return i < 0 ? letter.name : letter.say[i];
}

/**
 * Audio key for a clip. A bare letter is its name ("Ba"); with a harakah it is
 * the sound ("Bi"). Kept as one function so the player, the manifest and the
 * generator script cannot drift apart on filenames.
 */
export function audioKey(letterId, harakahId) {
  return harakahId ? `${letterId}-${harakahId}` : letterId;
}
