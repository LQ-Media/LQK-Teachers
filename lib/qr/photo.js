import "server-only";
import { callGemini, imagePart, IMAGE_MODEL, geminiConfigured } from "@/lib/gemini";
import { readTemplate, MIME_EXT } from "./assets";

export { geminiConfigured };

/* Turning a family's own photo into the event picture.

   Gemini is handed several images at once, in a fixed order, each introduced by
   a line of text saying what it is. That ordering is the whole technique: the
   model has no idea which of five unlabelled images is a background and which
   is a sponsor logo, and an unlabelled pile produces a collage. */

/* The house rules, which sit AFTER Karim's own prompt so they win.

   Two of these matter more than the rest. "Do not alter their faces" is what
   separates a keepsake from an uncanny stranger wearing your child's clothes —
   the whole point is that the family recognises themselves. "Do not invent
   people" stops the model helpfully adding a fourth child to balance the
   composition, which is the single most upsetting way this can fail. */
const HOUSE_RULES = [
  "The first image is a photograph of a real family. Keep every person in it: same faces, same skin tones, same hair, same approximate ages, same clothing unless the instructions above say otherwise.",
  "Do not alter, beautify, slim, lighten or age anyone's face. Their likeness must stay recognisable — this picture is a keepsake for them.",
  "Do not invent extra people, and do not remove anyone who is in the photograph.",
  "Cut the family out cleanly and place them into the scene. Match the lighting and colour of the background so they do not look pasted on.",
  "Reproduce any supplied logo exactly as given — same shapes, same colours, same wording. Never redraw or restyle a logo, and never invent text on it.",
  "Do not add any text, caption, watermark or signature that was not supplied as an image.",
  "This is for a Muslim community event: keep clothing modest and keep the scene respectful.",
].join("\n");

const ASSET_INTRO = {
  background: "The next image is the BACKGROUND TEMPLATE. Compose the final picture on it, keeping its layout and any empty space it leaves for people.",
  event_logo: "The next image is the EVENT LOGO. Place it neatly in the composition without covering anyone's face.",
  company_logo: "The next image is the COMPANY LOGO. Place it neatly, smaller than the event logo, without covering anyone's face.",
  sponsor_logo: "The next image is a SPONSOR LOGO. Place it discreetly, usually along an edge, without covering anyone's face.",
  detail: "The next image carries the EVENT DETAILS. Reproduce it legibly and do not rewrite its wording.",
  extra: "The next image is additional artwork to include.",
};

const DEFAULT_PROMPT =
  "Place the family into the background template as a warm, natural group portrait for the event.";

/** Everything the model is told, assembled — also stored so an odd result is explicable. */
export function buildPrompt(event, assets) {
  const own = String(event?.photo_prompt || "").trim() || DEFAULT_PROMPT;
  const supplied = assets.length
    ? `\nSupplied artwork, in order: ${assets.map((a) => a.kind).join(", ")}.`
    : "\nNo background or logos were supplied — invent a simple, tasteful backdrop.";
  const occasion = [event?.title, event?.venue_name].filter(Boolean).join(" at ");

  return [
    "You are producing a single finished event photograph for a family to keep.",
    occasion ? `The occasion is ${occasion}.` : "",
    "",
    "--- What the organiser asked for ---",
    own,
    supplied,
    "",
    "--- Rules that override the above ---",
    HOUSE_RULES,
  ]
    .filter(Boolean)
    .join("\n");
}

/**
 * Compose the event picture.
 *
 * `familyPhoto` is {mime, base64} held in MEMORY by the caller. It is never
 * written to disk here or anywhere else — the consent Karim chose is
 * "generate, then discard the original", and the cheapest way to honour that
 * is to give the original nowhere to persist to.
 *
 * @returns {{ ok: true, mime, bytes, prompt } | { ok: false, error, prompt? }}
 */
export async function composeFamilyPhoto({ event, assets, familyPhoto }) {
  if (!geminiConfigured()) {
    return { ok: false, error: "Photo generation isn’t switched on — GEMINI_API_KEY is missing." };
  }

  const prompt = buildPrompt(event, assets);
  const parts = [
    { text: prompt },
    { text: "\nThe next image is the FAMILY PHOTOGRAPH." },
    { inlineData: { mimeType: familyPhoto.mime, data: familyPhoto.base64 } },
  ];

  for (const asset of assets) {
    const bytes = readTemplate(asset.file_name);
    // A missing template file is survivable — better a picture without the
    // sponsor logo than no picture at all for a family who is waiting.
    if (!bytes) continue;
    parts.push({ text: `\n${ASSET_INTRO[asset.kind] || ASSET_INTRO.extra}` });
    parts.push({ inlineData: { mimeType: asset.mime, data: bytes.toString("base64") } });
  }

  const res = await callGemini(
    IMAGE_MODEL,
    {
      contents: [{ role: "user", parts }],
      generationConfig: { responseModalities: ["IMAGE"], imageConfig: { aspectRatio: "4:3" } },
    },
    // Generous: several images in, one image out, and a parent is watching a
    // spinner rather than refreshing. The default 90s cuts it close.
    { timeoutMs: 150_000 },
  );
  if (!res.ok) return { ok: false, error: res.error, prompt };

  const image = imagePart(res.candidate);
  if (!image) {
    return {
      ok: false,
      error: "Gemini didn’t return a picture. It sometimes declines a photo of people — try a different photo.",
      prompt,
    };
  }
  const mime = MIME_EXT[image.mime] ? image.mime : "image/png";
  return { ok: true, mime, bytes: Buffer.from(image.data, "base64"), prompt };
}
