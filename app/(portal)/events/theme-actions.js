"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getEvent, listEvents, updateEvent, approveThemeDraft } from "@/lib/events/queries";
import { sanitizeTheme } from "@/lib/events/theme";
import { generateThemeSpec, generateBackgroundArt, geminiConfigured } from "@/lib/events/gemini";
import { saveArt, pruneUnusedArt } from "@/lib/events/art";

/* Theme studio actions.

   Same rule as app/(portal)/events/actions.js: every export re-checks the role.
   A server action is a public POST endpoint, and these ones spend money at
   Google — an unauthenticated caller looping generateThemeAction would be a
   bill, not just a defacement.

   Everything a model produces lands in `themeDraft`, never in `theme`. The only
   action that touches the live theme is approveThemeAction, which Karim has to
   press. That gate is the reason it is safe to let a model design something
   200 guests will open. */

const MAX_REF_BYTES = 6 * 1024 * 1024;

/* Generates a design from a reference image and/or a written brief, and parks
   it in the draft slot. Never throws — the studio shows `error` inline, because
   a stack trace mid-design tells Karim nothing about what to change. */
export async function generateThemeAction(eventId, { imageDataUrl, brief, withArt = true } = {}) {
  await requireRole(["admin"]);
  if (!geminiConfigured()) return { ok: false, error: "GEMINI_API_KEY is not set on this server." };

  const event = getEvent(eventId);
  if (!event) return { ok: false, error: "Event not found." };

  if (imageDataUrl) {
    // base64 inflates by ~4/3 — check the decoded size, not the string length.
    const payload = String(imageDataUrl).split(",")[1] || "";
    if ((payload.length * 3) / 4 > MAX_REF_BYTES) {
      return { ok: false, error: "That reference image is over 6 MB — try a smaller one." };
    }
  }

  const spec = await generateThemeSpec({ imageDataUrl, brief, event });
  if (!spec.ok) return spec;

  const theme = sanitizeTheme(spec.spec);

  /* Art is generated only when the model asked for it AND Karim left the
     toggle on. A failure here is reported but does NOT sink the generation —
     the design is already good without a background, and losing a whole
     generation to a transient image-model error would be maddening. */
  let artNote = null;
  if (withArt && spec.artPrompt) {
    const art = await generateBackgroundArt(spec.artPrompt);
    if (art.ok) {
      const saved = await saveArt(art.bytes, art.mime);
      theme.bgImage = saved.url;
    } else {
      artNote = `Design generated, but the background art failed: ${art.error}`;
    }
  }

  updateEvent(eventId, { themeDraft: theme });
  revalidatePath(`/events/${eventId}/theme`);

  return {
    ok: true,
    theme: sanitizeTheme(theme),
    rationale: spec.rationale,
    artPrompt: spec.artPrompt,
    note: artNote,
  };
}

/* Regenerates just the background art against a hand-edited prompt, so Karim
   can keep a design he likes and only rework the picture behind it. */
export async function generateArtAction(eventId, prompt, theme) {
  await requireRole(["admin"]);
  if (!geminiConfigured()) return { ok: false, error: "GEMINI_API_KEY is not set on this server." };
  if (!String(prompt || "").trim()) return { ok: false, error: "Describe the background first." };

  const art = await generateBackgroundArt(prompt);
  if (!art.ok) return art;

  const saved = await saveArt(art.bytes, art.mime);
  const next = sanitizeTheme({ ...sanitizeTheme(theme), bgImage: saved.url });

  updateEvent(eventId, { themeDraft: next });
  revalidatePath(`/events/${eventId}/theme`);
  return { ok: true, theme: next };
}

/* Persists a hand-tweaked draft. The studio previews from React state, so this
   only has to run when Karim stops fiddling — it is the "don't lose my work"
   save, not the thing that drives the preview. */
export async function saveThemeDraftAction(eventId, theme) {
  await requireRole(["admin"]);
  const next = sanitizeTheme(theme);
  updateEvent(eventId, { themeDraft: next });
  revalidatePath(`/events/${eventId}/theme`);
  return { ok: true, theme: next };
}

/* The gate. Promotes the draft to the live theme — after this, guests see it. */
export async function approveThemeAction(eventId, theme) {
  await requireRole(["admin"]);

  // Save first so the approved theme is exactly what the preview showed, even
  // if the last few tweaks were never explicitly saved.
  if (theme) updateEvent(eventId, { themeDraft: sanitizeTheme(theme) });

  const event = approveThemeDraft(eventId);
  if (!event) return { ok: false, error: "Event not found." };

  /* Sweep art from the candidates Karim rejected. Safe only here: at this
     moment every surviving reference across every event is either a live theme
     or a draft, so anything unreferenced is genuinely abandoned. */
  try {
    pruneUnusedArt(listEvents().flatMap((e) => [e.theme?.bgImage, e.themeDraft?.bgImage]));
  } catch {}

  revalidatePath(`/events/${eventId}/theme`);
  revalidatePath(`/events/${eventId}`);
  return { ok: true, theme: event.theme };
}

export async function discardThemeDraftAction(eventId) {
  await requireRole(["admin"]);
  updateEvent(eventId, { themeDraft: null });
  revalidatePath(`/events/${eventId}/theme`);
  return { ok: true };
}
