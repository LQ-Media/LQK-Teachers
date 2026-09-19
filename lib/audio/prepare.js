/**
 * Browser-side preparation for an uploaded voice recording.
 *
 * Teachers mostly do not record inside the portal — they record the kuliah on
 * whatever their phone already has (iOS Voice Memos, Samsung Recorder, a
 * WhatsApp voice note someone forwarded them) and only sit down to write the
 * note afterwards. Two things stand between such a file and Whisper:
 *
 *   1. SIZE. The upload ceiling is 24 MB (lib/ai/provider.js). An hour of
 *      iPhone Voice Memo is ~28 MB, an hour of 128 kbps MP3 is ~58 MB — so the
 *      single most ordinary upload there is would be refused.
 *   2. FORMAT. Whisper takes a fixed list of containers. A Samsung .amr, a
 *      .aac, a .3gp from an older Android are all perfectly good audio that
 *      the provider will simply reject.
 *
 * Both are solved the same way: decode the file with the browser's own codecs,
 * downmix to 16 kHz mono (Whisper resamples to 16 kHz anyway, so nothing is
 * lost that the model would have used) and re-encode as plain WAV, split into
 * parts that each fit under the ceiling. 16 kHz mono 16-bit is 32 kB/s, so a
 * 10-minute part is ~19 MB — comfortably inside it.
 *
 * A file that is ALREADY small enough and in an accepted container skips all of
 * this and is posted untouched: no decode, no quality loss, no memory spike.
 *
 * Everything here is deliberately dependency-free and split into pure helpers
 * (resampleTo, planParts, encodeWav, …) so the arithmetic — the part that is
 * easy to get quietly wrong — is unit-tested in test/audio-prepare.test.mjs.
 */

/** Whisper works at 16 kHz; sending more is bytes the model throws away. */
export const TARGET_SAMPLE_RATE = 16_000;

/**
 * Seconds of audio per uploaded part. At 16 kHz mono 16-bit (32 kB/s) this is
 * ~19 MB, leaving room under the 24 MB ceiling for the WAV header, the
 * multipart envelope and a provider that counts megabytes as 1,000,000.
 */
export const MAX_PART_SECONDS = 600;

/**
 * Guards for the conversion path. Decoding holds the whole recording in memory
 * as PCM, so an absurd file has to be refused with a sentence a teacher can act
 * on rather than crashing the tab.
 *
 * 4 hours at 16 kHz mono is ~460 MB of float samples during decode — already
 * optimistic on a phone, and far longer than any kuliah.
 */
export const MAX_SOURCE_SECONDS = 4 * 60 * 60;
export const MAX_SOURCE_BYTES = 300 * 1024 * 1024;

/**
 * Containers Groq's Whisper endpoint accepts as-is. Anything outside this list
 * is re-encoded rather than refused — the browser can usually still decode it.
 */
const PROVIDER_EXTENSIONS = new Set([
  "flac", "m4a", "mp3", "mp4", "mpeg", "mpga", "ogg", "opus", "wav", "webm",
]);

const PROVIDER_MIME = new Set([
  "audio/flac", "audio/x-flac",
  "audio/mpeg", "audio/mp3",
  "audio/mp4", "audio/x-m4a", "audio/m4a",
  "video/mp4",
  "audio/ogg", "audio/opus",
  "audio/wav", "audio/x-wav", "audio/wave",
  "audio/webm", "video/webm",
]);

/**
 * File types a teacher plainly did not mean to hand the transcriber. Kept as a
 * deny-list rather than an allow-list because the accurate audio type of a file
 * is a mess in practice: Android hands over `application/octet-stream` for its
 * own recordings, and a forwarded WhatsApp note often arrives with no type at
 * all. Refusing those would block real recordings to catch a rare mistake.
 */
const OBVIOUSLY_NOT_AUDIO = /^(image|text)\//i;

export function extensionOf(name = "") {
  const match = /\.([a-z0-9]{1,5})$/i.exec(String(name).trim());
  return match ? match[1].toLowerCase() : "";
}

function baseMime(type = "") {
  return String(type).toLowerCase().split(";")[0].trim();
}

/** Could this file plausibly be a recording? Used only to catch obvious slips. */
export function looksLikeAudio({ name = "", type = "" } = {}) {
  const mime = baseMime(type);
  if (OBVIOUSLY_NOT_AUDIO.test(mime)) return false;
  if (mime === "application/pdf") return false;
  return true;
}

/**
 * True when the file can go straight to the provider untouched. The extension
 * wins when there is one — a phone's reported MIME type is often wrong, but a
 * `.m4a` really is an m4a.
 */
export function providerAccepts({ name = "", type = "" } = {}) {
  const ext = extensionOf(name);
  if (ext) return PROVIDER_EXTENSIONS.has(ext);
  return PROVIDER_MIME.has(baseMime(type));
}

/**
 * A prepare step that failed for a reason the UI should phrase itself.
 * `code` is one of: no-decoder | undecodable | empty | too-long | too-large.
 */
export class PrepareError extends Error {
  constructor(code, message) {
    super(message || code);
    this.name = "PrepareError";
    this.code = code;
  }
}

/** Flatten every channel into one, averaged. AudioBuffer-shaped input. */
export function mixToMono(buffer) {
  const channels = buffer.numberOfChannels;
  const length = buffer.length;
  if (channels === 1) return buffer.getChannelData(0);

  const out = new Float32Array(length);
  for (let c = 0; c < channels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) out[i] += data[i];
  }
  for (let i = 0; i < length; i++) out[i] /= channels;
  return out;
}

/**
 * Resample mono float samples.
 *
 * Downsampling averages each output sample's whole input window instead of
 * picking one sample from it. That averaging is a crude low-pass, and without
 * it 44.1 kHz → 16 kHz folds everything above 8 kHz back into the speech band
 * as aliasing — audible as a metallic hiss, and exactly the kind of noise that
 * makes Whisper invent words. Upsampling (rare — 8 kHz phone-call audio) uses
 * linear interpolation, which is plenty for speech.
 */
export function resampleTo(samples, fromRate, toRate) {
  if (!(fromRate > 0) || !(toRate > 0)) throw new RangeError("Sample rates must be positive.");
  if (fromRate === toRate) return samples;

  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(length);

  if (ratio > 1) {
    for (let i = 0; i < length; i++) {
      const start = Math.floor(i * ratio);
      const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let j = start; j < end; j++) {
        sum += samples[j];
        count++;
      }
      out[i] = count ? sum / count : samples[Math.min(start, samples.length - 1)] || 0;
    }
    return out;
  }

  for (let i = 0; i < length; i++) {
    const at = i * ratio;
    const low = Math.floor(at);
    const high = Math.min(low + 1, samples.length - 1);
    const fraction = at - low;
    out[i] = samples[low] * (1 - fraction) + samples[high] * fraction;
  }
  return out;
}

/** Float [-1, 1] to 16-bit PCM, clamped so a hot recording clips rather than wraps. */
export function toPcm16(samples) {
  const out = new Int16Array(samples.length);
  for (let i = 0; i < samples.length; i++) {
    const clamped = samples[i] < -1 ? -1 : samples[i] > 1 ? 1 : samples[i];
    out[i] = Math.round(clamped * (clamped < 0 ? 0x8000 : 0x7fff));
  }
  return out;
}

/**
 * Split a recording into as few parts as will fit the ceiling, then make them
 * equal length. Equal parts beat "fill each to the brim": chopping 65 minutes
 * into 10 + 10 + 10 + 10 + 10 + 10 + 5 leaves a 5-minute runt whose transcript
 * reads as an afterthought, where 7 × 9:17 reads as one talk.
 *
 * Returns [{ start, end }] sample offsets, end-exclusive.
 */
export function planParts(totalSamples, sampleRate, maxSeconds = MAX_PART_SECONDS) {
  if (!(totalSamples > 0)) return [];
  const maxSamples = Math.floor(maxSeconds * sampleRate);
  if (!(maxSamples > 0)) throw new RangeError("maxSeconds must cover at least one sample.");

  const count = Math.ceil(totalSamples / maxSamples);
  const per = Math.ceil(totalSamples / count);

  const parts = [];
  for (let start = 0; start < totalSamples; start += per) {
    parts.push({ start, end: Math.min(start + per, totalSamples) });
  }
  return parts;
}

/** Wrap 16-bit mono PCM in a canonical 44-byte WAV header. */
export function encodeWav(pcm16, sampleRate) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const bytes = pcm16.length * 2;

  const ascii = (offset, text) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, "RIFF");
  view.setUint32(4, 36 + bytes, true); // file size minus the first 8 bytes
  ascii(8, "WAVE");
  ascii(12, "fmt ");
  view.setUint32(16, 16, true); // PCM fmt chunk length
  view.setUint16(20, 1, true); // format 1 = uncompressed PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byte rate: rate x block align
  view.setUint16(32, 2, true); // block align: 1 channel x 16 bits
  view.setUint16(34, 16, true); // bits per sample
  ascii(36, "data");
  view.setUint32(40, bytes, true);

  // Copy rather than hand over pcm16.buffer: the caller slices parts out of one
  // long recording, so the underlying buffer is shared and must stay intact.
  const body = new Uint8Array(bytes);
  body.set(new Uint8Array(pcm16.buffer, pcm16.byteOffset, bytes));

  return new Blob([header, body], { type: "audio/wav" });
}

/**
 * Read a file's duration without decoding it — the browser only has to parse
 * the container's header. Used to refuse an impossible file before spending
 * several hundred megabytes of memory finding out.
 *
 * Resolves null when the duration cannot be read (some containers do not carry
 * one), which callers treat as "unknown, carry on".
 */
export function probeDuration(file) {
  return new Promise((resolve) => {
    if (typeof Audio === "undefined" || typeof URL?.createObjectURL !== "function") {
      resolve(null);
      return;
    }
    const url = URL.createObjectURL(file);
    const audio = new Audio();
    let settled = false;

    const finish = (value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      URL.revokeObjectURL(url);
      resolve(value);
    };

    // A container the browser cannot parse simply never fires either event.
    const timer = setTimeout(() => finish(null), 5000);

    audio.preload = "metadata";
    audio.onloadedmetadata = () =>
      finish(Number.isFinite(audio.duration) && audio.duration > 0 ? audio.duration : null);
    audio.onerror = () => finish(null);
    audio.src = url;
  });
}

function audioContextClass() {
  if (typeof window === "undefined") return null;
  return window.AudioContext || window.webkitAudioContext || null;
}

/**
 * Decode an uploaded file to 16 kHz mono 16-bit PCM.
 *
 * decodeAudioData resamples to the context's own rate, so asking for a 16 kHz
 * context does the conversion inside the browser's resampler — better than
 * anything worth writing here, and it halves peak memory versus decoding at
 * 48 kHz first. Older Safari refuses a context outside its native rate, hence
 * the fallback to a default context plus our own resampleTo.
 *
 * Throws PrepareError; every code is phrased for the teacher by the caller.
 */
export async function decodeToPcm16(file) {
  if (!file?.size) throw new PrepareError("empty");
  if (file.size > MAX_SOURCE_BYTES) throw new PrepareError("too-large");

  const Ctx = audioContextClass();
  if (!Ctx) throw new PrepareError("no-decoder");

  const seconds = await probeDuration(file);
  if (seconds && seconds > MAX_SOURCE_SECONDS) throw new PrepareError("too-long");

  let ctx;
  try {
    ctx = new Ctx({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    ctx = new Ctx();
  }

  try {
    const buffer = await ctx.decodeAudioData(await file.arrayBuffer());
    if (!buffer?.length) throw new PrepareError("empty");
    const mono = mixToMono(buffer);
    return toPcm16(resampleTo(mono, buffer.sampleRate, TARGET_SAMPLE_RATE));
  } catch (error) {
    if (error instanceof PrepareError) throw error;
    throw new PrepareError("undecodable");
  } finally {
    // An AudioContext holds an audio hardware handle; browsers cap how many a
    // page may have, so a teacher uploading several files in a row would
    // otherwise hit the limit and see a decode fail for no visible reason.
    try {
      await ctx.close?.();
    } catch {
      /* already closed */
    }
  }
}
