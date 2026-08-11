"use server";

import { revalidatePath } from "next/cache";
import {
  getGuestByToken,
  saveRsvp,
  attachPhoto,
  isEventClosed,
  markContributionPending,
} from "@/lib/events/queries";
import { isDeclineReason } from "@/lib/events/i18n";
import { getContributionProduct } from "@/lib/events/shopify";
import { contributionCheckoutUrl } from "@/lib/events/shopify-core";
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

/* Shared validation for both save paths. Returns {error} or the clean row. */
function validateReply(event, payload) {
  if (!["yes", "no"].includes(payload?.attending)) return { error: "required" };

  if (payload.attending === "no") {
    const reason = payload.declineReason;
    if (!isDeclineReason(reason)) return { error: "reasonRequired" };
    // "Another reason" IS the free-text line — an empty line answers nothing.
    if (reason === "other" && !String(payload.declineReasonNote || "").trim()) {
      return { error: "reasonRequired" };
    }
    return {
      attending: "no",
      declineReason: reason,
      declineReasonNote: reason === "other" ? payload.declineReasonNote : null,
      message: payload.message,
      photoConsent: payload.photoConsent,
    };
  }

  const adults = Math.max(0, Math.min(20, Number(payload.adults) || 0));
  const children = Math.max(0, Math.min(20, Number(payload.children) || 0));
  // Cap enforced server-side. The client stepper also caps, but the client is
  // not a security boundary and headcount drives catering spend.
  if (adults + children > (event.max_party_size || 10)) return { error: "partyTooBig" };
  if (adults + children < 1) return { error: "required" };

  return {
    attending: "yes",
    adults,
    children,
    extraNames: payload.extraNames,
    message: payload.message,
    photoConsent: payload.photoConsent,
  };
}

/* The final "Send my reply". When the event carries a contribution product,
   an attending reply is only complete once the store confirmed payment — the
   row itself was already saved by startContribution, so nothing is lost while
   the guest is away at checkout. */
export async function submitRsvp(token, payload) {
  const found = getGuestByToken(token);
  if (!found) return { ok: false, error: "notFound" };

  const { guest, event, rsvp } = found;
  if (event.status === "draft") return { ok: false, error: "notFound" };
  if (isEventClosed(event)) return { ok: false, error: "closed" };

  const clean = validateReply(event, payload);
  if (clean.error) return { ok: false, error: clean.error };

  if (
    clean.attending === "yes" &&
    event.support_url &&
    rsvp?.contribution_status !== "paid"
  ) {
    return { ok: false, error: "contribIncomplete", contributionStatus: rsvp?.contribution_status || "none" };
  }

  saveRsvp(guest.id, event.id, clean);
  revalidatePath(`/i/${token}`);
  return { ok: true, attending: clean.attending };
}

/* "Contribute & continue": SAVE the reply first (contribution pending), then
   hand back the store checkout URL tagged with the invitation. Saving first is
   deliberate — a checkout tab that never comes back must not cost us the
   family's headcount, and the webhook needs a row to land the payment on. */
export async function startContribution(token, payload) {
  const found = getGuestByToken(token);
  if (!found) return { ok: false, error: "notFound" };

  const { guest, event, rsvp } = found;
  if (event.status === "draft") return { ok: false, error: "notFound" };
  if (isEventClosed(event)) return { ok: false, error: "closed" };
  if (!event.support_url) return { ok: false, error: "error" };

  const clean = validateReply(event, { ...payload, attending: "yes" });
  if (clean.error) return { ok: false, error: clean.error };

  const product = await getContributionProduct(event.support_url);
  if (!product) return { ok: false, error: "error" };

  saveRsvp(guest.id, event.id, clean);

  // Already paid (e.g. a second click after the webhook landed): no second
  // checkout — report the truth instead.
  if (rsvp?.contribution_status === "paid") {
    revalidatePath(`/i/${token}`);
    return { ok: true, alreadyPaid: true };
  }

  markContributionPending(guest.id, product.title);
  revalidatePath(`/i/${token}`);
  return {
    ok: true,
    checkoutUrl: contributionCheckoutUrl({
      variantId: product.variantId,
      token: guest.token,
      eventId: event.id,
    }),
  };
}

/* Photo upload is a SEPARATE action from the RSVP on purpose. Drive is a third
   party that can be slow or down, and an outage there must never cost us a
   reply — the RSVP is already committed by the time this runs. A failure here
   is reported as a photo problem, not an RSVP problem. */
export async function uploadFamilyPhoto(token, { dataUrl, familyName }) {
  const found = getGuestByToken(token);
  if (!found) return { ok: false, error: "notFound" };
  const { guest, event } = found;
  if (isEventClosed(event)) return { ok: false, error: "closed" };
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
