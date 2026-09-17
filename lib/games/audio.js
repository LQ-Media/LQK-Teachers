"use client";

/**
 * Sound for the Huruf games.
 *
 * The listening channel is half of what these games are for, so silence is a
 * failure state, not a neutral one. There are three sources and the player
 * falls down them in order:
 *
 *   1. A clip under /huruf/audio/ — what scripts/generate-huruf-audio.mjs
 *      writes, and what an ustazah's own recording would replace.
 *   2. The device's Arabic speech voice. Every iPad has one; most Android
 *      tablets do. Not as good as a recording, but it is a real Arabic voice
 *      saying the real syllable, and it costs nothing and needs no network.
 *   3. A chime. Not a pronunciation, but it confirms the touch landed, which
 *      is the one thing a child must never be left guessing about.
 *
 * Why Web Audio and not <audio>: these clips fire on every finger movement
 * milestone and every card tap. An <audio> element re-triggered that fast
 * stutters and, on iOS, drifts further behind each time — and a sound that
 * arrives late teaches the wrong association. Decoded buffers fire in the same
 * frame as the touch.
 */

import { audioKey } from "@/lib/games/huruf";
import { arabicVoices, availableGenders, pickVoice, resolveGender } from "@/lib/games/voices";

const CLIP_BASE = "/huruf/audio";

let ctx = null;
const buffers = new Map();   // key → AudioBuffer | null (null = known missing)
const inflight = new Map();  // key → Promise
let musicNode = null;
let musicGain = null;

/**
 * iOS will not let a page make sound until a real gesture has run through the
 * audio context, so every game calls this from its first pointerdown. Safe and
 * cheap to call repeatedly.
 */
export function unlockAudio() {
  if (!ctx) {
    const Ctor = typeof window !== "undefined" && (window.AudioContext || window.webkitAudioContext);
    if (!Ctor) return null;
    ctx = new Ctor();
  }
  if (ctx.state === "suspended") ctx.resume().catch(() => {});
  return ctx;
}

async function load(key) {
  if (buffers.has(key)) return buffers.get(key);
  if (inflight.has(key)) return inflight.get(key);

  const job = (async () => {
    try {
      const res = await fetch(`${CLIP_BASE}/${key}.mp3`, { cache: "force-cache" });
      if (!res.ok) throw new Error(String(res.status));
      const buf = await unlockAudio()?.decodeAudioData(await res.arrayBuffer());
      buffers.set(key, buf ?? null);
      return buf ?? null;
    } catch {
      // Missing clip is the normal case until the generator has been run — it
      // must not look like a bug, and must not be retried on every tap.
      buffers.set(key, null);
      return null;
    } finally {
      inflight.delete(key);
    }
  })();

  inflight.set(key, job);
  return job;
}

/** Warm the cache for a screenful of letters so the first tap is instant. */
export function preload(keys) {
  for (const k of keys) load(k);
}

/**
 * HOW FAST A LETTER IS SAID
 *
 * One dial, because a letter said too quickly to copy is no use to a child
 * whatever the source. Lower is slower; 1 is the voice's natural pace.
 *
 * The two paths are not equivalent, and the difference matters here:
 *
 *   SAY_RATE drives speech synthesis, which genuinely stretches time — the
 *   voice slows down and the pitch stays where it was.
 *
 *   CLIP_RATE drives recorded clips, and Web Audio's playbackRate is
 *   resampling, not time-stretching: slowing a clip also drops its pitch. On
 *   a single syllable that reads as a deeper voice, which is a poor trade in
 *   a game about pronunciation, so clips play at their natural speed and are
 *   instead generated slowly in the first place (see the prompt in
 *   scripts/generate-huruf-audio.mjs). Change it here if you want it anyway —
 *   it is one number — but expect the pitch to move with it.
 */
/**
 * The speeds offered, fastest first.
 *
 * The Web Speech API's floor is 0.1, so 0.1x is the slowest speech the
 * platform admits to supporting — but "supported" and "useful" part company
 * well before that. Below about 0.5x, voices differ wildly: some stretch
 * cleanly, some turn syllabic and robotic, and some quietly clamp and ignore
 * the request entirely. 0.3x, 0.25x and 0.1x are here because they were asked
 * for and a child struggling with a makhraj may genuinely need them; do not be
 * surprised if a given tablet treats them as the same as 0.5x, and judge them
 * by ear on the device rather than by the number.
 *
 * 0.3 and 0.25 sit close together on purpose. On paper they are nearly the
 * same request; in practice some voices clamp at one and stretch at the other,
 * so having both means a teacher who finds 0.25x unusable on her tablet has
 * somewhere to go before jumping to 0.5x.
 */
export const SAY_RATES = [1, 0.8, 0.65, 0.5, 0.3, 0.25, 0.1];
const RATE_KEY = "lqk_games_rate";

/**
 * Where the dial starts, before any teacher has touched it: the slowest the
 * platform offers.
 *
 * Asked for directly. Worth knowing what it means in practice, because it is
 * the one setting whose effect varies most between tablets: 0.1 is the floor
 * the Web Speech API defines, and voices disagree about it wildly. Some
 * genuinely stretch the syllable out; some clamp silently and give you 0.5x;
 * some turn syllabic and robotic at that speed. So this is a request, not a
 * guarantee, and the right speed is still the one that sounds right on the
 * tablet in the room — which is why the control is in every game's header.
 */
export const DEFAULT_SAY_RATE = 0.1;
const DEFAULT_RATE = DEFAULT_SAY_RATE;

let sayRate = null; // resolved from storage on first use

export function getSayRate() {
  if (sayRate === null) {
    try {
      const saved = Number(localStorage.getItem(RATE_KEY));
      sayRate = SAY_RATES.includes(saved) ? saved : DEFAULT_RATE;
    } catch {
      sayRate = DEFAULT_RATE; // private mode / storage disabled
    }
  }
  return sayRate;
}

/**
 * Which voice to speak in: "auto", "male" or "female".
 *
 * "auto" is the default and means follow the mascot on the page — the ustaz
 * games sound male and the ustazah games sound female with nobody touching a
 * setting, which is the behaviour that was asked for. An explicit choice
 * overrides the mascot in every game, because a teacher who picks a voice has
 * usually done it because the other one is poor on her particular tablet.
 *
 * Kept next to the speech rate, and stored the same way, because they are the
 * same kind of thing: a preference about the voice that a teacher sets once.
 */
const VOICE_KEY = "lqk_games_voice";
const VOICE_CHOICES = ["auto", "male", "female"];
const DEFAULT_VOICE = "auto";

let voicePref = null;

export function getVoicePref() {
  if (voicePref === null) {
    try {
      const saved = localStorage.getItem(VOICE_KEY);
      voicePref = VOICE_CHOICES.includes(saved) ? saved : DEFAULT_VOICE;
    } catch {
      voicePref = DEFAULT_VOICE; // private mode / storage disabled
    }
  }
  return voicePref;
}

export function setVoicePref(choice) {
  voicePref = VOICE_CHOICES.includes(choice) ? choice : DEFAULT_VOICE;
  try {
    localStorage.setItem(VOICE_KEY, voicePref);
  } catch {
    // ignore — the choice still holds for this session
  }
  /* Drop the cached voice so the very next utterance uses the new one. Without
     this the change would not be heard until something else happened to
     invalidate the cache, which reads as the toggle not working. */
  arabicVoice = null;
  arabicVoiceFor = null;
  return voicePref;
}

export { VOICE_CHOICES };

/**
 * Which mascot is on screen, so that "auto" has something to follow.
 *
 * A module variable rather than an argument threaded through every call site:
 * the games speak from a dozen places between them, all of them inside a
 * touch handler where the mascot is a constant for the whole screen. GameShell
 * sets it once when a game mounts, which is the same place the rate and music
 * controls already live.
 */
let mascot = null;

export function setMascot(who) {
  if (who !== mascot) {
    mascot = who;
    // The effective voice may have just changed, so stop using the cached one.
    arabicVoice = null;
    arabicVoiceFor = null;
  }
  return mascot;
}

/** The gender actually being asked for right now, or null if nothing applies. */
export function effectiveGender() {
  return resolveGender(getVoicePref(), mascot);
}

export function setSayRate(rate) {
  sayRate = SAY_RATES.includes(rate) ? rate : DEFAULT_RATE;
  try {
    localStorage.setItem(RATE_KEY, String(sayRate));
  } catch {
    // the choice still applies for this session
  }
  return sayRate;
}

function playBuffer(buf, { gain = 1, rate = getSayRate() } = {}) {
  const c = unlockAudio();
  if (!c || !buf) return false;
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = gain;
  src.buffer = buf;
  src.playbackRate.value = rate;
  src.connect(g).connect(c.destination);
  src.start();
  return true;
}

/* ------------------------------------------------------- the device's voice */

/**
 * Speaking a letter with the device's own voice, which is what happens for
 * every letter until the clips are generated — so it has to work on the
 * hundredth letter, not just the first.
 *
 * iOS SPEECH IS FULL OF TRAPS AND ALL OF THEM LOOK THE SAME
 *
 * Every one of these produces the identical symptom — the first letter speaks,
 * and then nothing ever speaks again, with no error anywhere:
 *
 *   1. `cancel()` with an idle synthesiser wedges it. The call returns
 *      cleanly and every later `speak()` is silently dropped. So cancel is
 *      only ever called when something is actually speaking.
 *   2. A paused synthesiser accepts `speak()` and says nothing. iOS can leave
 *      it paused on its own (backgrounding the tab is enough), so it is
 *      resumed before every utterance.
 *   3. The utterance can be garbage-collected while it is still queued,
 *      because nothing in the page refers to it once `speak()` returns. The
 *      current one is kept in a module variable to hold a reference.
 *   4. The voice list is rebuilt behind the app's back, leaving a cached
 *      SpeechSynthesisVoice that no longer matches anything. The cached voice
 *      is re-resolved whenever it has gone stale.
 */

let arabicVoice = null;
let arabicVoiceFor = null; // the gender the cached voice was chosen for
let speaking = null; // holds the live utterance against trap 3
let sequence = null; // holds a queued run of utterances, for the same reason

// How long to wait for speech to actually begin before assuming the engine
// swallowed it. Long enough not to trip on a slow network voice starting up,
// short enough that the recovery still feels like a response to the touch.
const WATCHDOG_MS = 700;

function synthesiser() {
  return (typeof window !== "undefined" && window.speechSynthesis) || null;
}

function pickArabicVoice(synth, gender) {
  const voices = synth.getVoices();
  // Voices arrive asynchronously; an empty list means "not yet", never "no".
  if (!voices.length) return null;
  /* Re-resolve when the cached voice has been dropped from the list (trap 4),
     or when a different gender is being asked for than the cached voice was
     chosen to satisfy. The gender is part of the cache key precisely because
     the games switch it as a child moves between an ustaz game and an ustazah
     one, and a stale cache would keep the first game's voice. */
  if (!arabicVoice || !voices.includes(arabicVoice) || arabicVoiceFor !== gender) {
    // Local before network, and requested gender before either — see the
    // preference order documented on pickVoice in lib/games/voices.js.
    arabicVoice = pickVoice(voices, gender);
    arabicVoiceFor = gender;
  }
  return arabicVoice;
}

/**
 * What this device can actually do about voices — everything the UI needs to
 * describe itself truthfully.
 *
 * `loaded` matters because the voice list arrives asynchronously: an empty
 * list means "not yet", never "none", and a control that said "no Arabic
 * voice" during the first second would be wrong on every device.
 */
export function voiceSurvey() {
  const synth = synthesiser();
  if (!synth) return { genders: [], arabic: 0, loaded: false };
  const voices = synth.getVoices();
  return {
    genders: availableGenders(voices),
    arabic: arabicVoices(voices).length,
    loaded: voices.length > 0,
  };
}

/* Chrome populates the voice list after load, so a first attempt can find
   nothing. Dropping the cache on this event means the next attempt picks the
   real voice up instead of staying stuck on the chime fallback. */
if (typeof window !== "undefined" && window.speechSynthesis?.addEventListener) {
  window.speechSynthesis.addEventListener("voiceschanged", () => {
    arabicVoice = null;
    arabicVoiceFor = null;
  });
}

/**
 * One attempt at speaking, watched.
 *
 * THE WATCHDOG
 *
 * Browsers have many ways of accepting speak() and then saying nothing, and
 * enumerating them is a losing game: a network voice that could not be
 * reached, an engine wedged by something earlier, next year's platform bug.
 * What they all share is that `onstart` never fires.
 *
 * So the return value of speak() is not trusted — it only means the call was
 * made. Instead each attempt is checked afterwards: if nothing began, the
 * engine is cleared and tried once more, and if that fails too the chime
 * plays. The one outcome a child must never get is silence with no
 * explanation, and "the call returned true" is not evidence against it.
 */
function speakAttempt(synth, voice, text, rate, attempt) {
  // Only cancel a synthesiser that is busy — cancelling an idle one wedges it
  // on iOS and silences everything afterwards (trap 1).
  if (synth.speaking || synth.pending) synth.cancel();
  // A paused synthesiser swallows utterances without complaint (trap 2).
  if (synth.paused) synth.resume();

  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  // Nowhere near conversational pace: this is a sound being modelled for a
  // child to copy, not a sentence being read. Defaults to the platform floor —
  // see DEFAULT_SAY_RATE on how differently tablets honour it — and the
  // teacher changes it from the header of any game.
  u.rate = rate;

  let started = false;
  u.onstart = () => {
    started = true;
  };
  u.onend = () => {
    speaking = null;
  };
  u.onerror = () => {
    speaking = null;
  };
  speaking = u;
  synth.speak(u);

  setTimeout(() => {
    // Something else has spoken since; this attempt is no longer the story.
    if (started || speaking !== u) return;
    speaking = null;
    try {
      synth.cancel();
    } catch {
      // some engines throw on a cancel they do not need
    }
    if (attempt === 0) speakAttempt(synth, voice, text, rate, 1);
    else chime({ freq: 560 });
  }, WATCHDOG_MS);
}

export function speakArabic(text, { rate = getSayRate(), gender = effectiveGender() } = {}) {
  const synth = synthesiser();
  if (!synth) return false;
  const voice = pickArabicVoice(synth, gender);
  if (!voice) return false;
  speakAttempt(synth, voice, text, rate, 0);
  return true;
}

/* ------------------------------------------------------ procedural feedback */

/**
 * A short bell. Used as the last-resort voice and, quietly, as the tick that
 * marks progress while a finger is moving along a stroke — a sound generated
 * per touch rather than a file, so the game feels responsive with no assets at
 * all.
 */
export function chime({ freq = 660, duration = 0.16, gain = 0.15 } = {}) {
  const c = unlockAudio();
  if (!c) return;
  const osc = c.createOscillator();
  const g = c.createGain();
  osc.type = "sine";
  osc.frequency.value = freq;
  // A tiny attack and an exponential tail: a raw gate on a sine clicks.
  g.gain.setValueAtTime(0, c.currentTime);
  g.gain.linearRampToValueAtTime(gain, c.currentTime + 0.012);
  g.gain.exponentialRampToValueAtTime(0.0001, c.currentTime + duration);
  osc.connect(g).connect(c.destination);
  osc.start();
  osc.stop(c.currentTime + duration + 0.02);
}

/** Rising three-note flourish for a completed letter. */
export function fanfare() {
  [523.25, 659.25, 783.99].forEach((freq, i) => {
    setTimeout(() => chime({ freq, duration: 0.28, gain: 0.13 }), i * 110);
  });
}

/** Gentle two-note "try again" that is not a buzzer. */
export function nudge() {
  chime({ freq: 392, duration: 0.14, gain: 0.1 });
  setTimeout(() => chime({ freq: 330, duration: 0.18, gain: 0.1 }), 120);
}

/* ----------------------------------------------------------------- the voice */

/**
 * Say a letter — its name on its own, or its sound with a harakah.
 *
 * `arabic` is the written form, handed to the device voice when there is no
 * clip; it is the letter plus its mark, e.g. "بِ", because that is what has to
 * be pronounced.
 *
 * DELIBERATELY NOT ASYNC
 *
 * This used to `await load(key)` before speaking, and that single await was
 * enough to break it: iOS only starts speech from inside the user gesture that
 * asked for it, and awaiting — even an already-resolved promise — lets the call
 * drift out of one. The first letter of a session would speak and none of the
 * others would.
 *
 * So the cache is consulted synchronously, which is the normal case: preload()
 * runs when the letter changes, so by the time a child has finished tracing,
 * the answer for that letter is already known (usually "no clip", until the
 * generator has been run). Only a genuine cache miss falls back to waiting,
 * and that one may be mute on iOS — the next attempt on the same letter will
 * not be.
 */
function speakOrChime(buf, arabic, harakahId) {
  if (playBuffer(buf)) return "clip";
  if (arabic && speakArabic(arabic)) return "speech";
  chime({ freq: harakahId ? 700 : 560 });
  return "chime";
}

/**
 * Say several units one after another, each as its own sound.
 *
 * "Ba, Ta" — never "bat". That distinction is the entire point: a child
 * building بَتَ needs to hear the two pieces they chose, in order, as separate
 * syllables. Handing the whole string to a speech engine gets it read as a
 * word, which is the one thing this must not do.
 *
 * WHY EVERYTHING IS QUEUED INSIDE THE TAP
 *
 * iOS only starts speech from inside the gesture that asked for it, so the
 * obvious build — speak one, wait for it to end, speak the next — fails on the
 * second unit, because an onend callback is not a gesture. The Web Speech API
 * queues utterances natively, so every unit is handed over in the same tap and
 * the engine plays them in order with its own boundary between them. Nothing
 * waits on a timer, and nothing has to guess how long a syllable takes — which
 * matters at 0.1x, where one syllable can run for seconds.
 *
 * Recorded clips take the other path: their durations are known once decoded,
 * so they are scheduled back to back on the audio clock. Clips are used only
 * when EVERY unit has one, because half a sequence in a recorded voice and
 * half in the tablet's own is worse than either alone.
 *
 * `units` is [{ letterId, harakahId, arabic }]. Returns what it used, for
 * tests and for the caller to show something honest.
 */
const UNIT_GAP = 0.18; // seconds of silence between clips, so units stay distinct

export function sayUnits(units) {
  if (!units?.length) return "empty";

  /* Clips first, and only if all of them are already decoded — a cache miss
     cannot be awaited without leaving the gesture. */
  const bufs = units.map((u) => buffers.get(audioKey(u.letterId, u.harakahId)));
  if (bufs.every(Boolean)) {
    const c = unlockAudio();
    if (c) {
      let at = c.currentTime;
      for (const buf of bufs) {
        const src = c.createBufferSource();
        src.buffer = buf;
        src.connect(c.destination);
        src.start(at);
        at += buf.duration + UNIT_GAP;
      }
      return "clips";
    }
  }

  const synth = synthesiser();
  const voice = synth && pickArabicVoice(synth, effectiveGender());
  if (synth && voice) {
    if (synth.speaking || synth.pending) synth.cancel();
    if (synth.paused) synth.resume();

    const rate = getSayRate();
    const queued = units.map((u) => {
      const utt = new SpeechSynthesisUtterance(u.arabic);
      utt.voice = voice;
      utt.lang = voice.lang;
      utt.rate = rate;
      return utt;
    });
    /* Held for the same reason a single utterance is: nothing else refers to
       these once speak() returns, and an utterance collected while still
       queued is silently dropped (trap 3). */
    sequence = queued;

    let began = false;
    queued[0].onstart = () => {
      began = true;
    };
    for (const utt of queued) synth.speak(utt);

    setTimeout(() => {
      if (began || sequence !== queued) return;
      sequence = null;
      // Same contract as a single letter: silence with no explanation is the
      // one outcome a child must never get.
      for (let i = 0; i < units.length; i++) {
        setTimeout(() => chime({ freq: 560 + i * 60 }), i * 260);
      }
    }, WATCHDOG_MS);
    return "speech";
  }

  for (let i = 0; i < units.length; i++) {
    setTimeout(() => chime({ freq: 560 + i * 60 }), i * 260);
  }
  return "chime";
}

export function sayLetter({ letterId, harakahId = null, arabic }) {
  const key = audioKey(letterId, harakahId);
  if (buffers.has(key)) return speakOrChime(buffers.get(key), arabic, harakahId);
  load(key).then((buf) => speakOrChime(buf, arabic, harakahId));
  return "pending";
}

/* --------------------------------------------------------- ambient music bed */

/**
 * Optional background track. There is no music file in the repo — a nasheed bed
 * is a licensing decision, not a code one — so the control reports whether one
 * is actually there and the games disable the button when it is not, rather
 * than offering a toggle that does nothing. Drop an mp3 at
 * public/huruf/audio/ambient.mp3 and it starts working.
 */
export async function hasMusic() {
  return (await load("ambient")) !== null;
}

export async function startMusic({ gain = 0.12 } = {}) {
  const c = unlockAudio();
  const buf = await load("ambient");
  if (!c || !buf || musicNode) return false;
  musicNode = c.createBufferSource();
  musicGain = c.createGain();
  musicGain.gain.value = gain;
  musicNode.buffer = buf;
  musicNode.loop = true;
  musicNode.connect(musicGain).connect(c.destination);
  musicNode.start();
  return true;
}

export function stopMusic() {
  if (!musicNode) return;
  try {
    musicNode.stop();
  } catch {
    // already stopped
  }
  musicNode = null;
  musicGain = null;
}

/* ---------------------------------------------------------------- the hands */

/**
 * Haptic tick. Android tablets buzz; Safari on iPad and iPhone has no vibrate
 * API at all, which is why touch feedback in these games is always carried by
 * sound and light as well — the buzz is a bonus on the hardware that has it,
 * never the only signal.
 */
export function buzz(pattern = 18) {
  try {
    navigator.vibrate?.(pattern);
  } catch {
    // some browsers throw on a blocked or malformed pattern
  }
}
