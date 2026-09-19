/**
 * Choosing a male or a female voice, to match the mascot on the page.
 *
 * WHAT THE PLATFORM DOES NOT GIVE US
 *
 * A SpeechSynthesisVoice has a name, a language, a voiceURI and a localService
 * flag. It does NOT have a gender. There is no field to read and no argument to
 * pass: the Web Speech API simply does not model it, and the SSML that does is
 * not reachable through SpeechSynthesisUtterance.
 *
 * So gender here is inferred from the voice's NAME, against the table below.
 * That has two consequences worth being honest about rather than papering over:
 *
 *   1. The table cannot be complete. Platforms add and rename voices, and a
 *      voice this file does not recognise has an unknown gender — not a
 *      guessed one. genderOf() returns null and the caller treats it as "no
 *      information", which is why unknown voices are still usable as a
 *      fallback but are never labelled male or female in the UI.
 *   2. MOST DEVICES SHIP ONLY ONE ARABIC VOICE. iOS has historically shipped
 *      Maged and nothing else; Chrome on a desktop usually exposes a single
 *      network voice. On such a device there is no choice to offer, whatever
 *      the UI would like to do — so availableGenders() reports what the device
 *      can actually deliver, and the control disables itself when that is
 *      fewer than two. A toggle that pretends to change something it cannot is
 *      worse than one that admits it.
 *
 * WHY THE NAMES ARE ENOUGH TO GO ON
 *
 * The voices in these catalogues are named after people — Maged, Salma, Hamed,
 * Zariyah — and an Arabic given name carries its gender unambiguously. So the
 * table is a list of first names, not a list of product strings, which means
 * one entry covers a name across every locale and vendor that uses it:
 * "Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)" and a bare
 * "Hamed" resolve the same way.
 *
 * Google is the exception. Its Arabic voices are named by letter rather than by
 * person — ar-XA-Standard-A and so on — so those are matched by the documented
 * letter-to-gender mapping instead.
 */

/* Arabic given names used by the Apple, Microsoft/Azure and other Arabic voice
   catalogues. Keyed by the lowercased first name, because that is the part that
   survives every vendor's decoration. Spelling variants are listed out rather
   than fuzzy-matched: "laila" and "layla" are both shipped, by different
   vendors, for different locales. */
const FEMALE_NAMES = [
  "amal",
  "amany",
  "amina",
  "aysha",
  "fatima",
  "hala",
  "hoda",
  "iman",
  "laila",
  "layla",
  "maryam",
  "mouna",
  "noura",
  "rana",
  "reem",
  "salma",
  "sana",
  "zariyah",
];

const MALE_NAMES = [
  "abdullah",
  "ali",
  "bassel",
  "fahed",
  "hamdan",
  "hamed",
  "hedi",
  "ismael",
  "jamal",
  "laith",
  "maged",
  "majed",
  "moaz",
  "naayf",
  "omar",
  "rami",
  "saleh",
  "shakir",
  "taim",
  "tarik",
];

/* Google names its Arabic voices by letter. The mapping is Google's own, from
   the ar-XA voice list: A and D are female, B and C are male. It applies to
   every tier, so Standard, Wavenet, Neural2 and Chirp all read the same way. */
const GOOGLE_LETTER = { a: "female", d: "female", b: "male", c: "male" };

/** Which mascot speaks with which voice. The whole point of the feature. */
export const MASCOT_VOICE = { ustaz: "male", ustazah: "female" };

export const GENDERS = ["male", "female"];

/**
 * The gender of a voice by its name, or null when this file does not know.
 *
 * Null is a real answer and callers must handle it: an unrecognised voice is
 * still perfectly usable, it just cannot be offered as "the male one".
 */
export function genderOf(name) {
  if (!name) return null;
  const raw = String(name);

  /* Google's letter-coded voices first, because the letter is meaningful and
     the surrounding text is not. Matched on the whole name so that a hyphen
     followed by a single letter at the end is what triggers it, rather than
     any stray letter inside a word. */
  const google = /(?:^|[\s-])(?:standard|wavenet|neural2|news|chirp[\w-]*|polyglot|studio)-([a-z])\b/i.exec(raw);
  if (google) {
    const g = GOOGLE_LETTER[google[1].toLowerCase()];
    if (g) return g;
  }

  /* Then the person-named voices. The name is split on anything that is not a
     letter so that vendor decoration ("Microsoft", "Online", "(Natural)", the
     locale in parentheses) falls apart into tokens and only the given name
     needs to match. */
  const tokens = raw.toLowerCase().split(/[^a-zÀ-ɏ]+/).filter(Boolean);
  for (const token of tokens) {
    if (FEMALE_NAMES.includes(token)) return "female";
    if (MALE_NAMES.includes(token)) return "male";
  }
  return null;
}

/** Is this an Arabic voice? Matches ar, ar-SA, ar_EG and ar-XA alike. */
export function isArabic(voice) {
  return !!voice && /^ar\b/i.test(String(voice.lang ?? "").replace("_", "-"));
}

/** The Arabic voices from a full voice list, in the order the platform gave. */
export function arabicVoices(voices) {
  return (voices ?? []).filter(isArabic);
}

/**
 * Group the Arabic voices by what this file can tell about them.
 *
 * `unknown` is not a failure bucket to be ignored — on a device whose only
 * Arabic voice is unrecognised, it holds the voice that will actually do the
 * speaking.
 */
export function groupByGender(voices) {
  const out = { male: [], female: [], unknown: [] };
  for (const v of arabicVoices(voices)) {
    out[genderOf(v.name) ?? "unknown"].push(v);
  }
  return out;
}

/**
 * Which genders this device can genuinely speak in.
 *
 * Used to enable or disable the control. Returning fewer than two is the
 * common case, not an error.
 */
export function availableGenders(voices) {
  const groups = groupByGender(voices);
  return GENDERS.filter((g) => groups[g].length > 0);
}

/**
 * Pick the voice to speak with.
 *
 * Preference order, and each step earns its place:
 *
 *   1. A voice of the requested gender — LOCAL before network. Chrome's Arabic
 *      voice is usually synthesised on Google's servers: it needs
 *      connectivity, it is rate-limited, and when it fails it fails silently.
 *      In a classroom on poor wifi the local voice is the one that keeps
 *      working, so it wins even over a preferred-gender network voice.
 *   2. Failing that, ANY Arabic voice, local first. A child waiting to hear a
 *      letter is better served by the wrong-gendered voice than by silence,
 *      and this is the path every device with one Arabic voice takes.
 *
 * Returns null only when there is no Arabic voice at all, which is the
 * caller's signal to fall back to the chime.
 */
export function pickVoice(voices, gender = null) {
  const arabic = arabicVoices(voices);
  if (!arabic.length) return null;

  const localFirst = (list) => list.find((v) => v.localService) ?? list[0] ?? null;

  if (gender) {
    const wanted = arabic.filter((v) => genderOf(v.name) === gender);
    const match = localFirst(wanted);
    if (match) return match;
  }
  return localFirst(arabic);
}

/**
 * Resolve a stored preference into a gender to ask for.
 *
 * "auto" means follow the mascot on the page, which is the default and the
 * behaviour that was asked for: the ustaz sounds male and the ustazah sounds
 * female without anyone touching a setting. An explicit choice overrides the
 * mascot everywhere, because a teacher who has picked a voice has picked it
 * for a reason — most likely that the other one is unintelligible on her
 * tablet.
 */
export function resolveGender(preference, mascot) {
  if (preference === "male" || preference === "female") return preference;
  return MASCOT_VOICE[mascot] ?? null;
}
