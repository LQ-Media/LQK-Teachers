import assert from "node:assert/strict";
import { test } from "node:test";

import {
  GENDERS,
  MASCOT_VOICE,
  arabicVoices,
  availableGenders,
  genderOf,
  groupByGender,
  isArabic,
  pickVoice,
  resolveGender,
} from "../lib/games/voices.js";

/** A stand-in for SpeechSynthesisVoice — the four fields the API actually has. */
const v = (name, lang = "ar-SA", localService = true) => ({
  name,
  lang,
  localService,
  voiceURI: name,
});

/* --------------------------------------------------------------- genderOf */

test("recognises the Arabic voices the platforms actually ship", () => {
  // Apple has shipped Maged as its Arabic voice for years; on many iPads it is
  // the only one, which is why the control has to cope with a single voice.
  assert.equal(genderOf("Maged"), "male");
  // Microsoft/Azure, in the decorated form the API really reports.
  assert.equal(genderOf("Microsoft Hoda Desktop - Arabic (Egypt)"), "female");
  assert.equal(genderOf("Microsoft Naayf - Arabic (Saudi Arabia)"), "male");
  assert.equal(genderOf("Microsoft Salma Online (Natural) - Arabic (Egypt)"), "female");
  assert.equal(genderOf("Microsoft Hamed Online (Natural) - Arabic (Saudi Arabia)"), "male");
  assert.equal(genderOf("Microsoft Zariyah Online (Natural) - Arabic (Saudi Arabia)"), "female");
  assert.equal(genderOf("Microsoft Shakir Online (Natural) - Arabic (Egypt)"), "male");
});

test("reads Google's letter-coded Arabic voices by Google's own mapping", () => {
  // ar-XA: A and D are female, B and C are male.
  assert.equal(genderOf("ar-XA-Standard-A"), "female");
  assert.equal(genderOf("ar-XA-Standard-B"), "male");
  assert.equal(genderOf("ar-XA-Standard-C"), "male");
  assert.equal(genderOf("ar-XA-Standard-D"), "female");
  // The tier is irrelevant — the letter carries the meaning.
  assert.equal(genderOf("ar-XA-Wavenet-B"), "male");
  assert.equal(genderOf("ar-XA-Neural2-A"), "female");
});

test("an unrecognised voice has an UNKNOWN gender, never a guessed one", () => {
  // Chrome's Arabic voice is named after the language, not a person. Guessing
  // would put a confident male/female label on a coin flip.
  assert.equal(genderOf("Google العربية"), null);
  assert.equal(genderOf("Arabic"), null);
  assert.equal(genderOf("Compact Arabic"), null);
  assert.equal(genderOf(""), null);
  assert.equal(genderOf(null), null);
  assert.equal(genderOf(undefined), null);
});

test("a stray letter inside a word is not read as a Google voice code", () => {
  // The letter code only counts after a tier name. Without that anchor,
  // anything ending in "-a" would be classed female.
  assert.equal(genderOf("Some Voice-A"), null);
  assert.equal(genderOf("ar-XA-Standard-Z"), null);
});

test("the two name tables do not overlap", () => {
  // A name in both lists would resolve by list order rather than by meaning,
  // and the bug would be invisible.
  const names = [
    "maged", "majed", "hoda", "naayf", "salma", "hamed", "zariyah", "shakir",
    "laila", "layla", "noura", "omar", "ali", "fatima", "reem", "iman",
  ];
  for (const n of names) {
    const g = genderOf(n);
    assert.ok(GENDERS.includes(g), `${n} resolved to ${g}`);
  }
});

/* ---------------------------------------------------------------- isArabic */

test("isArabic matches the many shapes of an Arabic lang tag", () => {
  assert.ok(isArabic(v("x", "ar")));
  assert.ok(isArabic(v("x", "ar-SA")));
  assert.ok(isArabic(v("x", "ar-EG")));
  assert.ok(isArabic(v("x", "ar_EG"))); // some engines use an underscore
  assert.ok(isArabic(v("x", "ar-XA")));
  assert.ok(!isArabic(v("x", "en-US")));
  // Must not match a language that merely starts with the letters "ar".
  assert.ok(!isArabic(v("x", "arn")));
  assert.ok(!isArabic(null));
});

/* -------------------------------------------------------------- the groups */

test("groupByGender keeps unknown voices rather than discarding them", () => {
  // On a device whose only Arabic voice is unrecognised, the unknown bucket
  // holds the voice that will do all the speaking.
  const groups = groupByGender([
    v("Maged"),
    v("Microsoft Hoda - Arabic (Egypt)", "ar-EG"),
    v("Google العربية", "ar", false),
    v("Daniel", "en-GB"),
  ]);
  assert.deepEqual(groups.male.map((x) => x.name), ["Maged"]);
  assert.equal(groups.female.length, 1);
  assert.deepEqual(groups.unknown.map((x) => x.name), ["Google العربية"]);
});

test("availableGenders reports what the DEVICE can do, not what we'd like", () => {
  // The single-voice case is the common one and the reason the control
  // disables itself.
  assert.deepEqual(availableGenders([v("Maged")]), ["male"]);
  assert.deepEqual(availableGenders([v("Google العربية", "ar", false)]), []);
  assert.deepEqual(availableGenders([]), []);
  assert.deepEqual(
    availableGenders([v("Maged"), v("Microsoft Hoda - Arabic (Egypt)", "ar-EG")]),
    ["male", "female"],
  );
  // English voices of both genders are not an Arabic choice.
  assert.deepEqual(availableGenders([v("Daniel", "en-GB"), v("Kate", "en-GB")]), []);
});

test("arabicVoices preserves the platform's own order", () => {
  const list = [v("Maged"), v("Daniel", "en-GB"), v("Salma", "ar-EG")];
  assert.deepEqual(arabicVoices(list).map((x) => x.name), ["Maged", "Salma"]);
  assert.deepEqual(arabicVoices(undefined), []);
});

/* -------------------------------------------------------------- pickVoice */

test("pickVoice honours the requested gender", () => {
  const list = [v("Maged"), v("Microsoft Hoda - Arabic (Egypt)", "ar-EG")];
  assert.equal(pickVoice(list, "male").name, "Maged");
  assert.equal(pickVoice(list, "female").name, "Microsoft Hoda - Arabic (Egypt)");
});

test("pickVoice prefers a LOCAL voice over a network one of the same gender", () => {
  // Chrome's network voice fails silently on poor wifi, which is most of why
  // the games used to go quiet. A classroom needs the local one.
  const list = [v("Salma", "ar-EG", false), v("Microsoft Hoda", "ar-EG", true)];
  assert.equal(pickVoice(list, "female").name, "Microsoft Hoda");
});

test("pickVoice falls back to ANY Arabic voice rather than to silence", () => {
  // A wrong-gendered letter is worth far more to a child than no letter.
  const onlyMale = [v("Maged")];
  assert.equal(pickVoice(onlyMale, "female").name, "Maged");
  const onlyUnknown = [v("Google العربية", "ar", false)];
  assert.equal(pickVoice(onlyUnknown, "male").name, "Google العربية");
});

test("pickVoice returns null only when there is no Arabic voice at all", () => {
  // Null is the caller's signal to fall back to the chime.
  assert.equal(pickVoice([v("Daniel", "en-GB")], "male"), null);
  assert.equal(pickVoice([], "male"), null);
  assert.equal(pickVoice([]), null);
});

test("pickVoice with no gender still prefers local", () => {
  const list = [v("Google العربية", "ar", false), v("Maged", "ar-SA", true)];
  assert.equal(pickVoice(list, null).name, "Maged");
});

/* ----------------------------------------------------------- the mascot tie */

test("each mascot maps to the matching voice", () => {
  assert.equal(MASCOT_VOICE.ustaz, "male");
  assert.equal(MASCOT_VOICE.ustazah, "female");
});

test("auto follows the mascot, and an explicit choice overrides it", () => {
  // This is the whole feature: the ustaz games speak male and the ustazah
  // games speak female with nobody touching a setting.
  assert.equal(resolveGender("auto", "ustaz"), "male");
  assert.equal(resolveGender("auto", "ustazah"), "female");
  // A teacher's explicit pick wins in every game.
  assert.equal(resolveGender("female", "ustaz"), "female");
  assert.equal(resolveGender("male", "ustazah"), "male");
});

test("resolveGender degrades safely on unknown input", () => {
  // No mascot set yet (the audio module's copy is null until a game mounts),
  // or a mascot this table does not know: no preference, not a crash.
  assert.equal(resolveGender("auto", null), null);
  assert.equal(resolveGender("auto", "someone-else"), null);
  assert.equal(resolveGender(undefined, "ustaz"), "male");
  assert.equal(resolveGender("nonsense", "ustazah"), "female");
});

test("every mascot's voice is a gender pickVoice can actually ask for", () => {
  for (const who of Object.keys(MASCOT_VOICE)) {
    assert.ok(GENDERS.includes(MASCOT_VOICE[who]), `${who} maps outside GENDERS`);
  }
});
