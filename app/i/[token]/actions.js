"use server";

import { revalidatePath } from "next/cache";
import {
  getGuestByToken,
  saveRsvp,
  attachPhoto,
} from "@/lib/events/queries";
import { uploadPhoto, photoFilename, driveConfigured } from "@/lib/events/drive";

/* Server actions for the public invite page.

   SECURITY MODEL: the token in the URL is the entire credential. Every action
   therefore re-resolves the guest from the token itself and NEVER trusts a
   guest id, event id or party size sent from the client — a hostile guest can
   post anything, but they can only ever affect the row their own token maps to.

   Actions return {ok, error} instead of throwing: a thrown server action shows
   a guest the Next.js error page, and losing a filled-in RSVP to a stack trace
   is the worst failure this page has. */

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;

function closed(event) {
  if (event.status === "closed") return true;
  if (!event.rsvp_deadline) return false;
  // End of the deadline day in Singapore, not the stroke of midnight UTC.
  return Date.now() > new Date(`${event.rsvp_deadline}T23:59:59+08:00`).getTime();
}

export async function submitRsvp(token, payload) {
  const found = getGuestByToken(token);
  if (!found) return { ok: false, error: "notFound" };

  const { guest, event } = found;
  if (event.status === "draft") return { ok: false, error: "notFound" };
  if (closed(event)) return { ok: false, error: "closed" };

  if (!["yes", "no", "maybe"].includes(payload?.attending)) {
    return { ok: false, error: "required" };
  }

  const adults = Math.max(0, Math.min(20, Number(payload.adults) || 0));
  const children = Math.max(0, Math.min(20, Number(payload.children) || 0));

  // Cap enforced server-side. The client stepper also caps, but the client is
  // not a security boundary and headcount drives catering spend.
  if (payload.attending === "yes" && adults + children > (event.max_party_size || 10)) {
    return { ok: false, error: "partyTooBig" };
  }

  saveRsvp(guest.id, event.id, {
    attending: payload.attending,
    adults: payload.attending === "yes" ? adults : 0,
    children: payload.attending === "yes" ? children : 0,
    extraNames: payload.extraNames,
    dietary: payload.dietary,
    message: payload.message,
    photoConsent: payload.photoConsent,
  });

  revalidatePath(`/i/${token}`);
  return { ok: true, attending: payload.attending };
}

/* Photo upload is a SEPARATE action from the RSVP on purpose. Drive is a third
   party that can be slow or down, and an outage there must never cost us a
   reply — the RSVP is already committed by the time this runs. A failure here
   is reported as a photo problem, not an RSVP problem. */
export async function uploadFamilyPhoto(token, { dataUrl, familyName }) {
  const found = getGuestByToken(token);
  if (!found) return { ok: false, error: "notFound" };
  const { guest, event } = found;
  if (closed(event)) return { ok: false, error: "closed" };
  if (!driveConfigured()) return { ok: false, error: "driveNotConfigured" };

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) return { ok: false, error: "badImage" };

  const [, mime, base64] = match;
  // base64 inflates by ~4/3; check the decoded size, not the string length.
  if ((base64.length * 3) / 4 > MAX_PHOTO_BYTES) return { ok: false, error: "tooLarge" };

  const filename = photoFilename({
    familyName: familyName || guest.family_name || guest.name,
    guestName: guest.name,
    token: guest.token,
    mime,
  });

  const result = await uploadPhoto({
    base64,
    mime,
    filename,
    eventSlug: event.slug,
  });

  if (!result.ok) return { ok: false, error: result.error || "uploadFailed" };

  attachPhoto(guest.id, result.fileId);
  revalidatePath(`/i/${token}`);
  return { ok: true, filename };
}
