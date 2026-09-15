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

function playBuffer(buf, { gain = 1 } = {}) {
  const c = unlockAudio();
  if (!c || !buf) return false;
  const src = c.createBufferSource();
  const g = c.createGain();
  g.gain.value = gain;
  src.buffer = buf;
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
let speaking = null; // holds the live utterance against trap 3

function synthesiser() {
  return (typeof window !== "undefined" && window.speechSynthesis) || null;
}

function pickArabicVoice(synth) {
  const voices = synth.getVoices();
  // Voices arrive asynchronously; an empty list means "not yet", never "no".
  if (!voices.length) return null;
  // Re-resolve when the cached voice has been dropped from the list (trap 4).
  if (!arabicVoice || !voices.includes(arabicVoice)) {
    arabicVoice = voices.find((v) => /^ar\b/i.test(v.lang)) ?? null;
  }
  return arabicVoice;
}

export function speakArabic(text) {
  const synth = synthesiser();
  if (!synth) return false;
  const voice = pickArabicVoice(synth);
  if (!voice) return false;

  // Only cancel a synthesiser that is busy — cancelling an idle one wedges it
  // on iOS and silences everything afterwards (trap 1).
  if (synth.speaking || synth.pending) synth.cancel();
  // A paused synthesiser swallows utterances without complaint (trap 2).
  if (synth.paused) synth.resume();

  const u = new SpeechSynthesisUtterance(text);
  u.voice = voice;
  u.lang = voice.lang;
  // Slower than speech: this is a single syllable being modelled for a child,
  // not a sentence being read.
  u.rate = 0.75;
  u.onend = () => {
    speaking = null;
  };
  u.onerror = () => {
    speaking = null;
  };
  speaking = u;
  synth.speak(u);
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
