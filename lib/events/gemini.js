import "server-only";
import { LAYOUTS, ORNAMENTS, MOTIONS, FONT_PAIRS, DEFAULT_THEME } from "./theme";

/* Gemini, used to design an invitation.

   THE RULE THIS FILE EXISTS TO ENFORCE: the model returns a design *spec*, never
   markup. It picks a layout by name from a fixed list, six hex colours, a font
   pairing and an ornament — and lib/events/theme.js#sanitizeTheme clamps all of
   it before anything renders. So the worst a bad generation can do is look
   wrong. It cannot overflow a phone, fail a contrast ratio, or inject anything
   into a guest's browser.

   Two models, because they are genuinely different jobs:
   - gemini-flash-latest reads the sample image and returns the JSON spec.
   - gemini-2.5-flash-image draws optional background art.

   Model-id notes carried over from the Camel Caravan work, all learned the hard
   way: `gemini-2.5-flash` 404s for keys issued recently, so the alias
   `gemini-flash-latest` is the safe choice. It is a *thinking* model — the
   reasoning tokens come out of maxOutputTokens, so anything under ~2000 returns
   an empty candidate that looks exactly like a refusal. */

import {
  callGemini,
  geminiConfigured,
  redact,
  TEXT_MODEL as SPEC_MODEL,
  IMAGE_MODEL,
} from "@/lib/gemini";

// Re-exported so existing import sites (the studio page, the actions) keep
// working against this module rather than reaching past it.
export { geminiConfigured, redact };

/* ---- the design spec ---------------------------------------------------- */

/* An OpenAPI-subset schema, which is what Gemini accepts. It is NOT the
   security boundary — sanitizeTheme is. Its job is to stop the model from
   free-associating field names, so the first-pass result is usually usable. */
const THEME_SCHEMA = {
  type: "object",
  properties: {
    layout: { type: "string", enum: LAYOUTS },
    palette: {
      type: "object",
      properties: {
        bg: { type: "string" },
        surface: { type: "string" },
        ink: { type: "string" },
        muted: { type: "string" },
        accent: { type: "string" },
        line: { type: "string" },
      },
      required: ["bg", "surface", "ink", "muted", "accent", "line"],
    },
    fontPair: { type: "string", enum: Object.keys(FONT_PAIRS) },
    scale: { type: "number" },
    radius: { type: "number" },
    ornament: { type: "string", enum: ORNAMENTS },
    ornamentOpacity: { type: "number" },
    motion: { type: "string", enum: MOTIONS },
    artPrompt: { type: "string" },
    rationale: { type: "string" },
  },
  required: ["layout", "palette", "fontPair", "ornament", "motion", "rationale"],
};

const SPEC_INSTRUCTIONS = `You are designing a printed-quality digital invitation for Little Quran Kids, an Islamic children's Quran school in Singapore.

Return ONLY a design spec matching the schema. You are not writing HTML or CSS — a hardened renderer owns the layout, and you choose its settings.

LAYOUTS (pick the one that matches the reference):
- centered-classic: stacked and centred, generous vertical rhythm. The safe, formal choice.
- framed-panel: content inside an ornamental double border. Traditional, ceremonial.
- photo-hero: a full-bleed image band across the top, content beneath. Only pick this if you also give an artPrompt.
- side-band: a vertical decorative band down one edge. Modern, editorial.
- arch-window: content inside an arch/mihrab silhouette. Strongly Islamic, works beautifully for religious events.
- minimal-rule: type only, hairline rules, lots of air. Contemporary and restrained.

PALETTE — six hex colours, "#RRGGBB":
- bg: the page behind the card.
- surface: the card itself. Body text sits on THIS, so it must be light and low-chroma.
- ink: body text. Must reach 7:1 contrast against surface. Go genuinely dark.
- muted: secondary text. At least 4.5:1 against surface.
- accent: buttons, rules, ornament. At least 4.5:1 against surface — a pale gold on white will be darkened automatically and lose its character, so choose a deep one.
- line: hairline borders. Subtle, close to surface.

ORNAMENT: geometric (Islamic tessellation), arabesque (flowing vegetal), botanical, artdeco, handdrawn, corner-flourish, or none.
FONT PAIRS: classic-serif, modern-sans, elegant-mix (Amiri headings + Nunito body), soft-round.
MOTION: none, fade, rise, reveal.
scale 0.85–1.25 (type size), radius 0–32 (corner rounding), ornamentOpacity 0–0.4.

artPrompt: optional. If background art would help, describe it in one sentence for an image model — abstract, pale, no text, no human or animal figures (this is an Islamic religious context), nothing that would compete with type laid over it. Omit it entirely if the design is better without.

rationale: one or two sentences, addressed to the admin, on what you took from the reference and why.

HOUSE CONSTRAINTS, which override the reference:
- Never pure black on pure white. Warm the neutrals.
- No figurative imagery of people or animals anywhere.
- The invitation may be read in Arabic, so the design must not depend on left-to-right asymmetry to work.`;

/* Turns a reference image and/or a written brief into a theme spec.

   Returns the RAW object. The caller sanitizes — keeping that separate means
   sanitizeTheme stays the single door, and the studio can show the model's
   rationale and artPrompt, which are not part of a theme. */
export async function generateThemeSpec({ imageDataUrl, mime, brief, event } = {}) {
  const parts = [];

  const context = [
    event?.title ? `Event: ${event.title}` : null,
    event?.host_name ? `Hosted by: ${event.host_name}` : null,
    event?.venue_name ? `Venue: ${event.venue_name}` : null,
    event?.dress_code ? `Dress code: ${event.dress_code}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  parts.push({
    text: [
      SPEC_INSTRUCTIONS,
      context ? `\n--- This invitation ---\n${context}` : "",
      brief ? `\n--- What the admin asked for ---\n${brief}` : "",
      imageDataUrl
        ? "\n--- Reference ---\nThe attached image is a mood reference. Take its palette, weight and character — do NOT copy its text or reproduce it. Produce an original design in the same spirit."
        : "\n--- Reference ---\nNo reference image was supplied. Design from the brief and the event details alone.",
    ]
      .filter(Boolean)
      .join("\n"),
  });

  if (imageDataUrl) {
    const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(imageDataUrl);
    if (!match) return { ok: false, error: "That reference image isn't a JPEG, PNG or WebP." };
    parts.push({ inline_data: { mime_type: mime || match[1], data: match[2] } });
  }

  const res = await callGemini(SPEC_MODEL, {
    contents: [{ role: "user", parts }],
    generationConfig: {
      responseMimeType: "application/json",
      responseSchema: THEME_SCHEMA,
      // A thinking model spends this budget on reasoning first. Anything under
      // ~2000 reliably returns an empty candidate.
      maxOutputTokens: 4096,
      temperature: 1,
    },
  });
  if (!res.ok) return res;

  const text = (res.candidate.content?.parts || [])
    .map((p) => p.text || "")
    .join("")
    .trim();
  if (!text) return { ok: false, error: "Gemini returned an empty design." };

  let spec;
  try {
    spec = JSON.parse(text);
  } catch {
    return { ok: false, error: "Gemini's design wasn't valid JSON." };
  }

  return {
    ok: true,
    spec,
    artPrompt: typeof spec.artPrompt === "string" ? spec.artPrompt.slice(0, 400) : null,
    rationale: typeof spec.rationale === "string" ? spec.rationale.slice(0, 600) : null,
  };
}

/* ---- background art ------------------------------------------------------ */

const ART_GUARDRAILS =
  "Abstract decorative background artwork for an Islamic children's school invitation. " +
  "Pale and low-contrast so dark text remains readable over it. " +
  "No text, no lettering, no calligraphy, no people, no animals, no faces. " +
  "Soft edges, even composition, no strong focal point.";

/* Returns raw PNG/JPEG bytes for the caller to store on the volume.

   Deliberately NOT a data: URI. sanitizeTheme would accept one, but a
   background image inlined into theme_json is re-sent inside the HTML of every
   invitation every guest opens — a 300 KB image becomes 400 KB of base64 on
   each page load, uncacheable. Stored as a file it is one cached request. */
export async function generateBackgroundArt(prompt) {
  const res = await callGemini(IMAGE_MODEL, {
    contents: [{ role: "user", parts: [{ text: `${ART_GUARDRAILS}\n\n${String(prompt || "").slice(0, 400)}` }] }],
    generationConfig: {
      responseModalities: ["IMAGE"],
      imageConfig: { aspectRatio: "3:4" },
    },
  });
  if (!res.ok) return res;

  const part = (res.candidate.content?.parts || []).find(
    (p) => p.inline_data?.data || p.inlineData?.data
  );
  const data = part?.inline_data?.data || part?.inlineData?.data;
  if (!data) return { ok: false, error: "Gemini returned no image." };

  return {
    ok: true,
    bytes: Buffer.from(data, "base64"),
    mime: part.inline_data?.mime_type || part.inlineData?.mimeType || "image/png",
  };
}

export const THEME_DEFAULTS = DEFAULT_THEME;
