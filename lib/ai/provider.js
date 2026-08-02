import "server-only";

/**
 * Thin AI provider for the Halaqah Notebook — no npm dependency, plain fetch.
 *
 * Two independent, OPTIONAL providers. Every feature degrades to "off" when its
 * key is missing; typed notes always work without any key at all.
 *
 *   GROQ_API_KEY    → audio transcription (Whisper) + note summarising.
 *                     Free tier at time of writing: 2,000 transcription
 *                     requests and 28,800 audio-seconds (8h) per day.
 *   GEMINI_API_KEY  → reading text out of a photo. Groq has no production
 *                     vision model, so this is a separate provider.
 *
 * Both are read at call time (not module load) so a host can add a key and
 * restart without a rebuild.
 */

const GROQ_BASE = "https://api.groq.com/openai/v1";
const GEMINI_BASE = "https://generativelanguage.googleapis.com/v1beta";

// Overridable so a host can move off the free tier without a code change.
const TRANSCRIBE_MODEL = process.env.LQK_AI_TRANSCRIBE_MODEL || "whisper-large-v3";
const CHAT_MODEL = process.env.LQK_AI_CHAT_MODEL || "llama-3.3-70b-versatile";
const VISION_MODEL = process.env.LQK_AI_VISION_MODEL || "gemini-2.5-flash";

// Groq's free tier caps uploads at 25MB. Stay under it with headroom — the
// client records at ~32kbps mono, so 24MB is roughly 100 minutes of audio.
export const MAX_AUDIO_BYTES = 24 * 1024 * 1024;
export const MAX_IMAGE_BYTES = 8 * 1024 * 1024;

// Keep one summarise call comfortably inside the free tier's token budget.
// ~48k characters is roughly a 2-hour talk; longer input is trimmed with a
// visible note rather than silently truncated.
const MAX_SUMMARY_CHARS = 48_000;

export const NOTE_LANGUAGES = [
  { code: "auto", label: "Detect automatically" },
  { code: "ms", label: "Malay" },
  { code: "en", label: "English" },
  { code: "ar", label: "Arabic" },
];

export function aiCapabilities() {
  const groq = Boolean(process.env.GROQ_API_KEY);
  return {
    transcribe: groq,
    summarise: groq,
    vision: Boolean(process.env.GEMINI_API_KEY),
  };
}

function fail(error) {
  return { ok: false, error };
}

/**
 * Whisper mishears Islamic vocabulary it has no context for ("tajwid" becomes
 * "tajweed"/"the wheat", surah names get anglicised inconsistently). Whisper
 * accepts a prompt that biases its vocabulary toward the expected domain — it
 * is a spelling hint, not an instruction, so it stays short and is just a word
 * list. This measurably steadies term spelling across a talk.
 */
const VOCAB_HINT =
  "Kuliah, syarahan, halaqah, ustaz, ustazah, tajwid, makhraj, hafazan, tilawah, " +
  "hadith, sunnah, sirah, fiqh, akhlak, tauhid, ayat, surah, juz, insyaAllah, " +
  "alhamdulillah, subhanallah, Al-Fatihah, Al-Baqarah, Yasin, Al-Kahfi, Al-Mulk.";

/**
 * Transcribe a recorded talk. `language` is an ISO-639-1 hint or "auto".
 *
 * Note on mixed-language talks: a Singapore kuliah is typically Malay with
 * Arabic quotation. Whisper detects ONE language per file, so passing "ms"
 * keeps the Malay narration accurate and renders the Arabic quotes
 * phonetically — which is what a note-taker wants. "auto" is offered but is
 * less predictable on code-switching audio.
 */
export async function transcribeAudio(file, { language = "auto" } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return fail("Transcription is not configured on this server.");
  if (!file || typeof file.arrayBuffer !== "function") return fail("No audio received.");
  if (file.size > MAX_AUDIO_BYTES) {
    return fail(`Recording is too large (${Math.round(file.size / 1024 / 1024)}MB). The limit is 24MB — about 100 minutes.`);
  }

  const body = new FormData();
  body.set("file", file, file.name || "audio.webm");
  body.set("model", TRANSCRIBE_MODEL);
  body.set("response_format", "json");
  body.set("prompt", VOCAB_HINT);
  if (language && language !== "auto") body.set("language", language);

  let res;
  try {
    res = await fetch(`${GROQ_BASE}/audio/transcriptions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}` },
      body,
    });
  } catch {
    return fail("Could not reach the transcription service. Check your connection and try again.");
  }

  if (!res.ok) return fail(await providerError(res, "transcribe"));

  const json = await res.json().catch(() => null);
  const text = String(json?.text || "").trim();
  if (!text) return fail("The recording came back empty — it may be silent or too quiet.");
  return { ok: true, text };
}

/** Read the text out of a photographed page. Printed text only, realistically. */
export async function extractImageText(file) {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return fail("Reading text from photos is not configured on this server.");
  if (!file || typeof file.arrayBuffer !== "function") return fail("No image received.");
  if (file.size > MAX_IMAGE_BYTES) return fail("That image is too large. Please use one under 8MB.");

  const base64 = Buffer.from(await file.arrayBuffer()).toString("base64");
  const payload = {
    contents: [
      {
        parts: [
          {
            text:
              "Transcribe all readable text in this image exactly as it appears. " +
              "Preserve Arabic script as Arabic (do not transliterate it) and keep the original line breaks. " +
              "If part of the page is unreadable, write [unclear] in that spot rather than guessing. " +
              "Return only the transcribed text, with no commentary.",
          },
          { inline_data: { mime_type: file.type || "image/jpeg", data: base64 } },
        ],
      },
    ],
  };

  let res;
  try {
    res = await fetch(`${GEMINI_BASE}/models/${VISION_MODEL}:generateContent`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify(payload),
    });
  } catch {
    return fail("Could not reach the image service. Check your connection and try again.");
  }

  if (!res.ok) return fail(await providerError(res, "read this image"));

  const json = await res.json().catch(() => null);
  const text = String(json?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("") || "").trim();
  if (!text) return fail("No readable text was found in that image.");
  return { ok: true, text };
}

/**
 * The summariser's contract. Note two deliberate fields:
 *  - `references[].verseKey` lets the UI deep-link into the portal's own Quran
 *    reader, so a teacher can verify a citation in one tap.
 *  - `uncertain` is where the model must declare what it could not make out.
 *    Religious content is exactly the wrong place for confident guessing, so
 *    the prompt requires this list and the UI always shows it.
 */
const SUMMARY_INSTRUCTIONS = `You are helping a Quran teacher in Singapore turn their own notes from an Islamic talk (kuliah/syarahan/halaqah) into a tidy personal study note.

Return ONLY a JSON object with exactly these keys:
{
  "title": string,
  "overview": string,
  "points": [{ "heading": string, "detail": string }],
  "references": [{ "type": "quran" | "hadith" | "other", "label": string, "verseKey": string | null, "detail": string }],
  "glossary": [{ "term": string, "arabic": string | null, "meaning": string }],
  "classUse": [string],
  "uncertain": [string]
}

Rules:
- Write in the same language as the source. If the source is Malay, write in Malay. Keep Arabic quotations in Arabic script.
- "title": a short, specific title. No date, no speaker name.
- "overview": 2-3 sentences on what the talk was actually about.
- "points": the substance of the talk, in the order it was given. 3-8 entries. Each "detail" is 1-3 sentences.
- "references": every Quran or hadith citation you can identify. For a Quran citation set "verseKey" to "surah:ayah" (e.g. "2:255"); if the exact ayah was not stated, set "verseKey" to null. NEVER invent a citation, a chain of narration, or a source that was not mentioned.
- "glossary": Arabic or religious terms a teacher with limited Arabic may not know. 0-8 entries. Leave "arabic" null if you are not certain of the spelling.
- "classUse": 2-4 concrete, practical ideas for using this material with children aged 4-12 at a Quran centre. Empty array if genuinely nothing applies.
- "uncertain": REQUIRED and important. List anything you could not make out, any citation you could not verify from the text, and any place the source was garbled or ambiguous. Use an empty array only if the source was completely clear. Do not smooth over gaps — the teacher needs to know what to check.
- Do not add rulings, opinions, or context that is not present in the source.`;

export async function summariseNote({ text, hint = "" } = {}) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return fail("Summarising is not configured on this server.");

  const source = String(text || "").trim();
  if (source.length < 40) return fail("There is not enough text to summarise yet.");

  const trimmed = source.length > MAX_SUMMARY_CHARS;
  const input = trimmed ? source.slice(0, MAX_SUMMARY_CHARS) : source;

  const userParts = [];
  if (hint) userParts.push(`Context from the teacher: ${hint}`);
  if (trimmed) userParts.push("(Note: this source was truncated — summarise only what is present.)");
  userParts.push("Source:\n\n" + input);

  let res;
  try {
    res = await fetch(`${GROQ_BASE}/chat/completions`, {
      method: "POST",
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: CHAT_MODEL,
        temperature: 0.2,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SUMMARY_INSTRUCTIONS },
          { role: "user", content: userParts.join("\n\n") },
        ],
      }),
    });
  } catch {
    return fail("Could not reach the summarising service. Check your connection and try again.");
  }

  if (!res.ok) return fail(await providerError(res, "summarise"));

  const json = await res.json().catch(() => null);
  const raw = json?.choices?.[0]?.message?.content;
  if (!raw) return fail("The summary came back empty. Try again.");

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return fail("The summary came back in an unexpected format. Try again.");
  }

  return { ok: true, summary: normaliseSummary(parsed, { trimmed }) };
}

/**
 * Coerce whatever the model returned into the exact shape the UI renders, so a
 * malformed field degrades to "missing" instead of crashing the note page.
 */
export function normaliseSummary(input, { trimmed = false } = {}) {
  const obj = input && typeof input === "object" ? input : {};
  const str = (v) => (typeof v === "string" ? v.trim() : "");
  const arr = (v) => (Array.isArray(v) ? v : []);

  const uncertain = arr(obj.uncertain).map(str).filter(Boolean);
  if (trimmed) {
    uncertain.unshift("The source was longer than the summariser can read in one pass, so the later part of the talk is not covered.");
  }

  return {
    title: str(obj.title),
    overview: str(obj.overview),
    points: arr(obj.points)
      .map((p) => ({ heading: str(p?.heading), detail: str(p?.detail) }))
      .filter((p) => p.heading || p.detail),
    references: arr(obj.references)
      .map((r) => ({
        type: ["quran", "hadith", "other"].includes(r?.type) ? r.type : "other",
        label: str(r?.label),
        verseKey: /^\d{1,3}:\d{1,3}$/.test(str(r?.verseKey)) ? str(r.verseKey) : null,
        detail: str(r?.detail),
      }))
      .filter((r) => r.label),
    glossary: arr(obj.glossary)
      .map((g) => ({ term: str(g?.term), arabic: str(g?.arabic) || null, meaning: str(g?.meaning) }))
      .filter((g) => g.term),
    classUse: arr(obj.classUse).map(str).filter(Boolean),
    uncertain,
  };
}

/** Turn a provider HTTP failure into something a teacher can act on. */
async function providerError(res, verb) {
  if (res.status === 429) {
    return `The free daily limit for this feature has been reached. Try again later, or save your note and summarise it tomorrow.`;
  }
  if (res.status === 401 || res.status === 403) {
    return `The server's key for this feature was rejected. Ask an admin to check it.`;
  }
  if (res.status === 413) {
    return `That file is too large to ${verb}.`;
  }
  const detail = await res.text().catch(() => "");
  console.error(`[lqk-ai] ${verb} failed ${res.status}: ${detail.slice(0, 500)}`);
  return `Could not ${verb} right now (error ${res.status}). Please try again.`;
}
