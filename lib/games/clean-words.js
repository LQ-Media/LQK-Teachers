/**
 * Keeping the blending drills clean.
 *
 * WHY THIS IS NOT PARANOIA
 *
 * A three-letter Arabic drill word is a consonant-vowel string built from a
 * small alphabet with only three vowels, and there are only so many of those.
 * Some of them collide with vulgarities in the languages spoken around a
 * Singapore classroom. The collisions are not hypothetical: ك + ن + ن with the
 * wrong harakat transliterates to a well-known Hokkien obscenity, and ب + ب
 * gives the Malay word for pig — which is its own problem in a Quran class even
 * though no dictionary would call it rude.
 *
 * A child reads these aloud, in front of other children, in a religious
 * school. One bad word getting through is a phone call from a parent, so the
 * filter runs over every candidate before it can reach a card.
 *
 * WHAT IS CHECKED
 *
 * Three surfaces, because a word can be innocent in one and not another:
 *
 *   1. The Arabic itself, stripped of harakat.
 *   2. The deck's transliteration ("Ka-Ni-Na"), joined and lowercased — this is
 *      what a child actually says out loud, and where the Malay, Hokkien and
 *      English collisions live.
 *   3. A loosened form of that transliteration, so that near-misses are caught
 *      too: doubled letters collapsed, and the letter pairs that Arabic
 *      transliteration uses interchangeably folded together (q/k, dz/z, sy/sh,
 *      ts/s, th/t, kh/h, gh/g). "Qonina" and "Kanina" must not need separate
 *      entries.
 *
 * ADDING TO THE LIST
 *
 * Only put real vulgarities in it. An entry that merely resembles one costs
 * real words: "shut" folds to "sut" and rejected سُطِحُ from the deck, and "fak"
 * folds to f-k and would have taken فَكَ. Over-blocking a word this game
 * GENERATED is free, but a word from the printed deck disappearing is a
 * regression, so the deck is screened in the tests as a guard.
 *
 * BLOCKED is otherwise deliberately short and deliberately extensible. It holds what is
 * confidently known to collide; the Malay, Hokkien and Cantonese vocabulary a
 * Singapore teacher would object to is wider than this file can honestly claim
 * to cover, and a missed word is worse than an over-blocked one — a rejected
 * drill costs nothing, since there are always more letter combinations. If a
 * teacher reports one, add it here with the language in the comment and the
 * tests will hold the behaviour.
 */

/* What must not appear in a drill word, in any of the surfaces above.
   Fragments rather than whole words, because these games build words by
   concatenation and a bad sound can land in the middle.

   `frame: true` also blocks every REVOWELLING of the same consonants, which is
   what catches "Qonina" from "kanina" and "Budo" from "bodo" — an Arabic drill
   picks its vowels freely, so the consonant frame is the thing that is really
   objectionable. It is only honoured for entries with three or more
   consonants, and that limit is enforced below rather than trusted: a
   two-consonant frame is far too broad. "bodo" would reduce to b-d and take
   عَبَدَ (to worship) and بَدَلَ with it, which is not a trade worth making in a
   Quran school. Short entries are matched literally instead, with their
   variants listed out. */
const BLOCKED = [
  // Hokkien / Singlish — the group an Arabic CVCVCV drill is most likely to
  // produce by accident, and the reason this file exists.
  { text: "kanina", lang: "hokkien", frame: true },
  { text: "lanjiao", lang: "hokkien", frame: true },
  { text: "cibai", lang: "hokkien" },
  { text: "chibai", lang: "hokkien" },
  { text: "knn", lang: "hokkien" },

  // Malay
  { text: "babi", lang: "malay" }, // pig — not obscene, but not for a Quran class
  { text: "bodo", lang: "malay" },
  { text: "budo", lang: "malay" },
  { text: "bodoh", lang: "malay" },
  { text: "sial", lang: "malay" },
  { text: "bangsat", lang: "malay", frame: true },
  { text: "pukima", lang: "malay", frame: true },
  { text: "puki", lang: "malay" },

  // English
  { text: "shit", lang: "english" },
  { text: "fuk", lang: "english" },
  { text: "fuc", lang: "english" },
  { text: "kunt", lang: "english" },
  { text: "cunt", lang: "english" },
  { text: "arse", lang: "english" },
  { text: "piss", lang: "english" },
  { text: "wank", lang: "english" },
  { text: "twat", lang: "english" },

  // Cantonese
  { text: "diu", lang: "cantonese" },

  // Arabic — coarse roots a dictionary would happily return
  { text: "\u062e\u0631\u0627", lang: "arabic" },
  { text: "\u0632\u0628\u064a", lang: "arabic" },
  { text: "\u0637\u064a\u0632", lang: "arabic" },
  { text: "\u0643\u0633", lang: "arabic" },
];

/* Words that must never be filtered, whatever the rules above say. Empty by
   design: it exists so that a teacher who finds a good word being rejected has
   somewhere to put it, rather than having to weaken a rule for everyone. The
   obvious candidates are Quranic roots that share a consonant frame with
   something coarse. */
const ALLOWED = [];

/** Harakat and the other marks the drills use, for stripping. */
const MARKS = /[ً-ْٓ-ٰٕ]/g;

/**
 * Fold the transliteration pairs Arabic romanisation treats as
 * interchangeable, so one blocklist entry catches its near neighbours.
 */
function loosen(latin) {
  return latin
    .replace(/[^a-z]/g, "")
    .replace(/sy|sh/g, "s")
    .replace(/ts/g, "s")
    .replace(/dz/g, "z")
    .replace(/kh/g, "h")
    .replace(/gh/g, "g")
    .replace(/th/g, "t")
    .replace(/q/g, "k")
    .replace(/(.)\1+/g, "$1");
}

/** Consonants only — the frame a drill can revowel at will. */
function frameOf(latin) {
  return loosen(latin).replace(/[aeiou]/g, "");
}

/**
 * Is this word safe to put on a card?
 *
 * `arabic` is the written word; `latin` is the deck's transliteration of it,
 * however the caller assembles it (e.g. "Ka-Ni-Na" or "KaNiNa"). Returns the
 * matched fragment when it is not clean, so a rejection can be logged with a
 * reason rather than disappearing silently.
 */
export function screenWord(arabic, latin = "") {
  const bare = String(arabic).replace(MARKS, "");
  const said = String(latin).toLowerCase().replace(/[^a-z]/g, "");
  const loose = loosen(String(latin).toLowerCase());
  const frame = frameOf(String(latin).toLowerCase());

  if (ALLOWED.includes(bare) || ALLOWED.includes(said)) return { clean: true };

  for (const entry of BLOCKED) {
    const bad = entry.text;
    if (/[\u0600-\u06FF]/.test(bad)) {
      /* A short Arabic entry is matched as the WHOLE word, not as a substring.
         Arabic roots are three letters and the coarse ones are two, so a
         substring rule on those is indiscriminate: \u0643\u0633 took \u0643\u064E\u0633\u064E\u0628\u064E (he earned,
         2:81) out of the Quran mining run, and would equally have taken \u0643\u064E\u0633\u064E\u0631\u064E
         (he broke) and \u0643\u064E\u0633\u064E\u0627 (he clothed). Three letters or more is specific
         enough for a substring to mean something. */
      const hit = bad.length >= 3 ? bare.includes(bad) : bare === bad;
      if (hit) {
        return { clean: false, matched: bad, lang: entry.lang, surface: "arabic" };
      }
      continue;
    }
    if (said.includes(bad)) {
      return { clean: false, matched: bad, lang: entry.lang, surface: "transliteration" };
    }
    const looseBad = loosen(bad);
    if (looseBad && loose.includes(looseBad)) {
      return { clean: false, matched: bad, lang: entry.lang, surface: "sound" };
    }
    // Revowellings, but only where the frame is specific enough to be safe.
    const badFrame = frameOf(bad);
    if (entry.frame && badFrame.length >= 3 && frame.includes(badFrame)) {
      return { clean: false, matched: bad, lang: entry.lang, surface: "frame" };
    }
  }
  return { clean: true };
}

/** Convenience for filtering a list; drops anything screenWord rejects. */
export function keepClean(words, latinOf) {
  return words.filter((w) => screenWord(w, latinOf ? latinOf(w) : "").clean);
}

/** Exposed for the tests and for a teacher reviewing what is filtered. */
export const BLOCKED_COUNT = BLOCKED.length;

/** For a teacher reviewing what the filter covers, grouped by language. */
export function blockedByLanguage() {
  const out = {};
  for (const e of BLOCKED) (out[e.lang] ??= []).push(e.text);
  return out;
}
