// Uploaded-recording preparation — the arithmetic behind "upload a voice note".
//
// A teacher uploads an hour-long voice memo from their phone; the browser has
// to turn it into parts that Whisper will actually accept. Every rule below is
// one that fails silently if broken: a part one sample over the ceiling comes
// back as a 413, a wrong WAV header transcribes as noise, an off-by-one in the
// splitter drops the last sentence of the kuliah.
//
// Run with `npm test`. No dependencies — Node's built-in runner.

import { test, describe } from "node:test";
import assert from "node:assert/strict";

import {
  MAX_PART_SECONDS,
  TARGET_SAMPLE_RATE,
  encodeWav,
  extensionOf,
  looksLikeAudio,
  mixToMono,
  planParts,
  providerAccepts,
  resampleTo,
  toPcm16,
} from "../lib/audio/prepare.js";

/** Stand-in for the AudioBuffer the browser hands back from decodeAudioData. */
function fakeBuffer(channels) {
  return {
    numberOfChannels: channels.length,
    length: channels[0].length,
    sampleRate: 48_000,
    getChannelData: (i) => channels[i],
  };
}

describe("which files can go straight to the provider", () => {
  test("an iPhone voice memo is accepted untouched", () => {
    assert.equal(providerAccepts({ name: "Kuliah Maghrib.m4a", type: "audio/x-m4a" }), true);
  });

  test("formats Whisper does not take are sent for conversion", () => {
    // Samsung recorders and older Android phones produce these routinely.
    assert.equal(providerAccepts({ name: "rakaman.amr", type: "audio/amr" }), false);
    assert.equal(providerAccepts({ name: "talk.aac", type: "audio/aac" }), false);
    assert.equal(providerAccepts({ name: "clip.3gp", type: "video/3gpp" }), false);
  });

  test("the extension wins over a phone's unreliable MIME type", () => {
    // Android hands over octet-stream for its own recordings; the name is right.
    assert.equal(providerAccepts({ name: "note.mp3", type: "application/octet-stream" }), true);
    // And an .amr labelled audio/mpeg is still an .amr.
    assert.equal(providerAccepts({ name: "note.amr", type: "audio/mpeg" }), false);
  });

  test("a file with no extension falls back to its MIME type", () => {
    assert.equal(providerAccepts({ name: "voice-note", type: "audio/ogg" }), true);
    assert.equal(providerAccepts({ name: "voice-note", type: "" }), false);
  });

  test("extensionOf ignores dots in the rest of the name", () => {
    assert.equal(extensionOf("Ustaz Ahmad - 12.01.2026.mp3"), "mp3");
    assert.equal(extensionOf("no-extension"), "");
  });
});

describe("catching an obvious wrong file", () => {
  test("a photo or a PDF is refused", () => {
    assert.equal(looksLikeAudio({ name: "page.jpg", type: "image/jpeg" }), false);
    assert.equal(looksLikeAudio({ name: "notes.pdf", type: "application/pdf" }), false);
  });

  test("audio with a vague or missing type is still let through", () => {
    // Refusing these would block real recordings to catch a rare slip — a
    // forwarded WhatsApp note often arrives with no type at all.
    assert.equal(looksLikeAudio({ name: "PTT-20260101.opus", type: "" }), true);
    assert.equal(looksLikeAudio({ name: "rec.amr", type: "application/octet-stream" }), true);
  });
});

describe("downmix and resample", () => {
  test("stereo is averaged into one channel", () => {
    const mono = mixToMono(fakeBuffer([new Float32Array([1, 0, -1]), new Float32Array([0, 0, 1])]));
    assert.deepEqual(Array.from(mono), [0.5, 0, 0]);
  });

  test("mono is passed through untouched", () => {
    const channel = new Float32Array([0.25, -0.25]);
    assert.equal(mixToMono(fakeBuffer([channel])), channel);
  });

  test("a matching rate does no work at all", () => {
    const samples = new Float32Array([0.1, 0.2]);
    assert.equal(resampleTo(samples, 16_000, 16_000), samples);
  });

  test("downsampling averages each window rather than picking one sample", () => {
    // Picking would keep [1, 1] and lose the alternation entirely; averaging
    // reports the flat signal that is really there. This is the anti-aliasing.
    const out = resampleTo(new Float32Array([1, -1, 1, -1]), 32_000, 16_000);
    assert.equal(out.length, 2);
    assert.deepEqual(Array.from(out), [0, 0]);
  });

  test("a downsampled hour is the length Whisper expects", () => {
    const out = resampleTo(new Float32Array(48_000), 48_000, TARGET_SAMPLE_RATE);
    assert.equal(out.length, TARGET_SAMPLE_RATE);
  });

  test("upsampling interpolates between neighbours", () => {
    const out = resampleTo(new Float32Array([0, 1]), 8_000, 16_000);
    assert.deepEqual(Array.from(out), [0, 0.5, 1, 1]);
  });

  test("a nonsense rate is refused rather than producing empty audio", () => {
    assert.throws(() => resampleTo(new Float32Array([0]), 0, 16_000), RangeError);
  });
});

describe("16-bit conversion", () => {
  test("full scale maps to the ends of the range", () => {
    assert.deepEqual(Array.from(toPcm16(new Float32Array([0, 1, -1]))), [0, 32767, -32768]);
  });

  test("a recording that overshoots clips instead of wrapping", () => {
    // Without the clamp, 1.5 wraps to a large NEGATIVE sample — a loud click on
    // every peak, which is far more damaging to transcription than clipping.
    assert.deepEqual(Array.from(toPcm16(new Float32Array([1.5, -1.5]))), [32767, -32768]);
  });
});

describe("splitting a long recording into parts", () => {
  const rate = TARGET_SAMPLE_RATE;
  const maxSamples = MAX_PART_SECONDS * rate;

  test("a recording that already fits stays in one piece", () => {
    const parts = planParts(rate * 60, rate);
    assert.deepEqual(parts, [{ start: 0, end: rate * 60 }]);
  });

  test("every part fits under the upload ceiling", () => {
    // 65 minutes: the length of an ordinary Friday kuliah recording.
    const total = rate * 65 * 60;
    for (const part of planParts(total, rate)) {
      assert.ok(part.end - part.start <= maxSamples, "a part exceeded the ceiling");
    }
  });

  test("parts are even, not one runt at the end", () => {
    const parts = planParts(rate * 65 * 60, rate);
    const lengths = parts.map((p) => p.end - p.start);
    const spread = Math.max(...lengths) - Math.min(...lengths);
    assert.ok(spread <= parts.length, `parts differ by ${spread} samples`);
  });

  test("the parts cover the whole talk with no gap and no overlap", () => {
    const total = rate * 47 * 60 + 137; // deliberately not a round number
    const parts = planParts(total, rate);
    assert.equal(parts[0].start, 0);
    assert.equal(parts.at(-1).end, total, "the end of the talk was dropped");
    for (let i = 1; i < parts.length; i++) {
      assert.equal(parts[i].start, parts[i - 1].end, "a gap or overlap between parts");
    }
  });

  test("the fewest possible parts are used", () => {
    // Each extra part is another round-trip, another chance to fail, and
    // another seam a sentence can be cut across.
    const total = rate * 25 * 60;
    assert.equal(planParts(total, rate).length, Math.ceil(total / maxSamples));
  });

  test("an empty recording plans no work", () => {
    assert.deepEqual(planParts(0, rate), []);
  });
});

describe("WAV encoding", () => {
  const read = async (blob) => new Uint8Array(await blob.arrayBuffer());
  const ascii = (bytes, at, length) =>
    String.fromCharCode(...bytes.subarray(at, at + length));
  const u32 = (bytes, at) => new DataView(bytes.buffer).getUint32(at, true);
  const u16 = (bytes, at) => new DataView(bytes.buffer).getUint16(at, true);

  test("the header describes 16 kHz mono 16-bit PCM", async () => {
    const bytes = await read(encodeWav(new Int16Array([0, 1, -1]), TARGET_SAMPLE_RATE));

    assert.equal(ascii(bytes, 0, 4), "RIFF");
    assert.equal(ascii(bytes, 8, 4), "WAVE");
    assert.equal(ascii(bytes, 12, 4), "fmt ");
    assert.equal(u16(bytes, 20), 1, "format should be uncompressed PCM");
    assert.equal(u16(bytes, 22), 1, "should be mono");
    assert.equal(u32(bytes, 24), TARGET_SAMPLE_RATE);
    assert.equal(u32(bytes, 28), TARGET_SAMPLE_RATE * 2, "byte rate");
    assert.equal(u16(bytes, 32), 2, "block align");
    assert.equal(u16(bytes, 34), 16, "bits per sample");
    assert.equal(ascii(bytes, 36, 4), "data");
  });

  test("the declared sizes match the bytes actually present", async () => {
    // A mismatch here is the classic "transcribes as silence or static" bug.
    const blob = encodeWav(new Int16Array(1_000), TARGET_SAMPLE_RATE);
    const bytes = await read(blob);
    assert.equal(bytes.length, 44 + 2_000);
    assert.equal(u32(bytes, 4), bytes.length - 8, "RIFF size");
    assert.equal(u32(bytes, 40), 2_000, "data chunk size");
    assert.equal(blob.type, "audio/wav");
  });

  test("samples survive the round trip little-endian", async () => {
    const bytes = await read(encodeWav(new Int16Array([0x0102, -2]), TARGET_SAMPLE_RATE));
    const view = new DataView(bytes.buffer);
    assert.equal(view.getInt16(44, true), 0x0102);
    assert.equal(view.getInt16(46, true), -2);
  });

  test("encoding one part does not consume the rest of the recording", async () => {
    // Parts are subarray views over one shared buffer. Handing the whole buffer
    // to the Blob would put the ENTIRE talk in every part — the upload would
    // balloon past the ceiling and each part would transcribe the same audio.
    const whole = new Int16Array([1, 2, 3, 4, 5, 6]);
    const part = whole.subarray(2, 4);
    const bytes = await read(encodeWav(part, TARGET_SAMPLE_RATE));

    assert.equal(bytes.length, 44 + 4);
    const view = new DataView(bytes.buffer);
    assert.equal(view.getInt16(44, true), 3);
    assert.equal(view.getInt16(46, true), 4);
  });

  test("a ten-minute part stays inside the 24 MB upload ceiling", async () => {
    const samples = MAX_PART_SECONDS * TARGET_SAMPLE_RATE;
    const size = 44 + samples * 2;
    assert.ok(size < 24 * 1024 * 1024, `a full part is ${Math.round(size / 1024 / 1024)}MB`);
  });
});
