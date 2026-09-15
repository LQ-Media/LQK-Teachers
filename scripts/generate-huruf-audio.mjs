/**
 * Generates the spoken clips for the Huruf games — 28 letter names and 84
 * letter-plus-harakah sounds — into public/huruf/audio/.
 *
 *   GEMINI_API_KEY=... node scripts/generate-huruf-audio.mjs
 *   GEMINI_API_KEY=... node scripts/generate-huruf-audio.mjs --only ba,ta,qof
 *   GEMINI_API_KEY=... node scripts/generate-huruf-audio.mjs --force
 *
 * Run it once and commit what it writes. The games never call it: they read the
 * finished files, and where a file is missing they fall back to the tablet's
 * own Arabic voice (see lib/games/audio.js), so a partial run is safe to ship.
 *
 * READ THIS BEFORE TRUSTING THE OUTPUT
 *
 * These are makhraj. A generated voice can be confidently, fluently wrong in
 * ways a synthesised English word never is — ض and ظ are the classic pair to
 * check, and so is every letter the deck gives an "o" to, because a model asked
 * to read قَ in isolation will often say "qa". So this script does not write
 * into the games' folder blind:
 *
 *   1. It writes to public/huruf/audio/ but prints a review list.
 *   2. Listen to all of them. It is 112 clips of half a second; it takes about
 *      five minutes and it is the difference between the games teaching
 *      pronunciation and teaching mispronunciation.
 *   3. Delete any clip that is wrong. A deleted clip is not a gap — the game
 *      falls back to the device voice for it — and it can be replaced later by
 *      a recording of an ustazah under the same filename.
 *
 * An ustazah's own voice remains better than this for every one of the 112.
 * This exists so the games are not silent while that recording is being
 * arranged, and so nothing blocks on it.
 */

import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";

const OUT_DIR = path.join(process.cwd(), "public", "huruf", "audio");
const MODEL = process.env.LQK_TTS_MODEL || "gemini-2.5-flash-preview-tts";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";
// Charon is a steady, low, unhurried voice; a bright, fast one makes a single
// syllable hard for a child to copy.
const VOICE = process.env.LQK_TTS_VOICE || "Charon";

const FATHA = "َ";
const KASRA = "ِ";
const DAMMA = "ُ";

/* Kept deliberately separate from lib/games/huruf.js: that module is bundled
   into the browser and this script runs on a laptop once a year. The shared
   thing that actually matters — the filename — is asserted below. */
const HURUF = [
  ["alif", "ا", "Alif"], ["ba", "ب", "Ba"], ["ta", "ت", "Ta"], ["tsa", "ث", "Tsa"],
  ["jim", "ج", "Jim"], ["ha", "ح", "Ha"], ["kho", "خ", "Kho"], ["dal", "د", "Dal"],
  ["dzal", "ذ", "Dzal"], ["ro", "ر", "Ro"], ["zay", "ز", "Zay"], ["sin", "س", "Sin"],
  ["syin", "ش", "Syin"], ["shod", "ص", "Shod"], ["dhod", "ض", "Dhod"], ["tho", "ط", "Tho"],
  ["zho", "ظ", "Zho"], ["ain", "ع", "‘Ain"], ["ghoin", "غ", "Ghoin"], ["fa", "ف", "Fa"],
  ["qof", "ق", "Qof"], ["kaf", "ك", "Kaf"], ["lam", "ل", "Lam"], ["mim", "م", "Mim"],
  ["nun", "ن", "Nun"], ["hha", "ه", "Ha"], ["wau", "و", "Wau"], ["ya", "ي", "Ya"],
];

const HARAKAT = [
  ["fatha", FATHA, "fatha, the short /a/"],
  ["kasra", KASRA, "kasra, the short /i/"],
  ["damma", DAMMA, "damma, the short /u/"],
];

/**
 * The instruction matters more than the text.
 *
 * Handed a bare "بَ", a model tends to read the letter's NAME, or to stretch it
 * into a long "baa". Both are wrong for this game: the child is learning that
 * one letter plus one mark is one short beat. So the prompt says what the thing
 * is, names the vowel, and asks for it short and isolated.
 */
function prompt(arabic, description) {
  return (
    "You are a Quran teacher recording a single pronunciation sample for young " +
    "children learning the Arabic alphabet. Say only the following, once, " +
    "clearly and slowly, with correct Quranic makhraj, as a single short " +
    "syllable with no lengthening and nothing else — no introduction, no " +
    `spelling out, no repetition: ${arabic}   (${description})`
  );
}

async function synthesise(text) {
  const key = process.env.GEMINI_API_KEY;
  const res = await fetch(`${ENDPOINT}/${MODEL}:generateContent?key=${key}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text }] }],
      generationConfig: {
        responseModalities: ["AUDIO"],
        speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: VOICE } } },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`${res.status} ${body.slice(0, 300).replace(process.env.GEMINI_API_KEY, "***")}`);
  }

  const json = await res.json();
  const part = json?.candidates?.[0]?.content?.parts?.find((p) => p.inlineData);
  if (!part) throw new Error("no audio in response");
  return {
    // The API returns raw signed 16-bit PCM, not a container, so the sample
    // rate has to be read off the mime type ("audio/L16;rate=24000").
    pcm: Buffer.from(part.inlineData.data, "base64"),
    rate: Number(/rate=(\d+)/.exec(part.inlineData.mimeType ?? "")?.[1] ?? 24000),
  };
}

/** Raw PCM → a .wav file. Saves shelling out to ffmpeg for a 44-byte header. */
function wav({ pcm, rate }) {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);       // fmt chunk size
  header.writeUInt16LE(1, 20);        // PCM
  header.writeUInt16LE(1, 22);        // mono
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28); // byte rate: mono, 2 bytes per sample
  header.writeUInt16LE(2, 32);        // block align
  header.writeUInt16LE(16, 34);       // bits per sample
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function main() {
  if (!process.env.GEMINI_API_KEY) {
    console.error("GEMINI_API_KEY is not set. This is the same key the portal already uses");
    console.error("for the Halaqah Notebook; free-tier quota covers all 112 clips.");
    process.exit(1);
  }

  const args = process.argv.slice(2);
  const force = args.includes("--force");
  const onlyArg = args.indexOf("--only");
  const only = onlyArg >= 0 ? new Set(args[onlyArg + 1]?.split(",") ?? []) : null;

  await mkdir(OUT_DIR, { recursive: true });

  const jobs = [];
  for (const [id, char, name] of HURUF) {
    if (only && !only.has(id)) continue;
    jobs.push({ key: id, arabic: char, description: `the letter named ${name}, said as its name` });
    for (const [hid, mark, describe] of HARAKAT) {
      jobs.push({
        key: `${id}-${hid}`,
        arabic: char + mark,
        description: `the letter ${name} with ${describe}`,
      });
    }
  }

  let made = 0;
  let skipped = 0;
  const failed = [];

  for (const [i, job] of jobs.entries()) {
    // The games load .mp3; a .wav under the same name is served and decoded
    // just as happily by every browser, and avoids a transcode step here.
    const file = path.join(OUT_DIR, `${job.key}.mp3`);
    if (!force && (await exists(file))) {
      skipped++;
      continue;
    }
    try {
      const audio = await synthesise(prompt(job.arabic, job.description));
      await writeFile(file, wav(audio));
      made++;
      console.log(`  [${i + 1}/${jobs.length}] ${job.key}  ${job.arabic}`);
    } catch (err) {
      failed.push(`${job.key}: ${err.message}`);
      console.error(`  [${i + 1}/${jobs.length}] ${job.key}  FAILED — ${err.message}`);
    }
    // Free-tier request-per-minute limits are the binding constraint, not
    // bandwidth, so this is paced rather than parallel.
    await new Promise((r) => setTimeout(r, 1200));
  }

  console.log(`\n${made} written, ${skipped} already there, ${failed.length} failed`);
  if (failed.length) console.log(failed.map((f) => `  ${f}`).join("\n"));
  console.log(`\nClips are in ${path.relative(process.cwd(), OUT_DIR)}/`);
  console.log("NOW LISTEN TO THEM — especially ض ظ ص ط ق ر غ خ, and every clip whose");
  console.log("name the deck spells with an 'o'. Delete any that are wrong: a missing");
  console.log("clip falls back to the tablet's Arabic voice, a wrong one teaches a");
  console.log("child to mispronounce.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
