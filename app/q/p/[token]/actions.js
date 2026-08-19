"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { getRegistrationByToken, savePhoto, deletePhoto } from "@/lib/qr/queries";
import { decodeDataUrl, writePhoto } from "@/lib/qr/assets";
import { composeFamilyPhoto } from "@/lib/qr/photo";

/* The family photo.

   PUBLIC — a parent has no account, the pass token is the credential — so this
   re-derives everything from the token rather than trusting an id from the
   client.

   THE THING TO NOT BREAK: the uploaded photograph is never written to disk.
   It is decoded into a Buffer, sent to Gemini, and goes out of scope. That is
   what the consent wording promises, and the cheapest way to keep a promise
   about deleting something is to never give it anywhere to persist to. */
export async function generateFamilyPhotoAction(token, { dataUrl, consented }) {
  const found = getRegistrationByToken(token);
  if (!found) return { ok: false, error: "That pass is no longer valid." };

  const { event, registration } = found;
  if (event.status === "draft") return { ok: false, error: "This event isn’t live." };
  if (!event.photo_enabled) return { ok: false, error: "This event isn’t asking for photos." };

  /* Consent is re-checked HERE, not just in the UI that disables the button. A
     server action is a public HTTP endpoint reachable by direct POST, and the
     one thing that must never happen is a child's photograph reaching a
     third-party API without the tick that was shown on screen. */
  if (!consented) {
    return { ok: false, error: "Please tick the box to say you agree before sending a photo." };
  }
  const consentText = String(event.photo_consent_text || "").trim();
  if (!consentText) {
    return { ok: false, error: "This event has no consent wording set, so photos are off." };
  }

  const decoded = decodeDataUrl(dataUrl);
  if (!decoded.ok) return decoded;

  const result = await composeFamilyPhoto({
    event,
    assets: event.assets,
    familyPhoto: { mime: decoded.mime, base64: decoded.base64 },
  });
  // Nothing is stored on a failure — not the upload, not a stub row. The
  // parent simply tries again.
  if (!result.ok) return { ok: false, error: result.error };

  const fileName = writePhoto(randomUUID(), result.mime, result.bytes);
  savePhoto(event.id, registration.id, {
    fileName,
    mime: result.mime,
    bytes: result.bytes.length,
    prompt: result.prompt,
    // Stored word-for-word as it was on screen: "they agreed" is worth nothing
    // without what they agreed to, and the wording can be edited later.
    consentText,
  });

  revalidatePath(`/q/p/${token}`);
  return { ok: true };
}

/* A family removing their own picture. No confirmation dance on the server —
   it is their photograph, and the answer to "please take that down" is yes. */
export async function deleteFamilyPhotoAction(token) {
  const found = getRegistrationByToken(token);
  if (!found) return { ok: false, error: "That pass is no longer valid." };
  deletePhoto(found.registration.id);
  revalidatePath(`/q/p/${token}`);
  return { ok: true };
}
