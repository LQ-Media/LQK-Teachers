"use server";

import { revalidatePath } from "next/cache";
import {
  getGuestByToken,
  saveRsvp,
  isEventClosed,
  markContributionPending,
} from "@/lib/events/queries";
import { isDeclineReason } from "@/lib/events/i18n";
import { validateAnswers } from "@/lib/events/fields";
import { MAX_PARTY_SIZE_LIMIT } from "@/lib/events/presets";
import { getContributionProduct } from "@/lib/events/shopify";
import { contributionCheckoutUrl, chooseVariant } from "@/lib/events/shopify-core";
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

/* Drive failures come back as free text — "network error", whatever the Apps
   Script threw, an HTTP status. None of that is a sentence to show a family,
   and t() passes an unknown key straight through, so an upload failure used to
   have a decent chance of printing the word "unauthorised" onto the invitation.

   The reason is logged instead. It is the only trace of WHY the folder is empty,
   and it belongs in Railway's logs where Karim can read it, not on the guest's
   screen. */
function photoError(where, result) {
  console.warn(`[events/photo] ${where}: ${result?.error || "unknown"}`);
  return result?.error === "driveNotConfigured" ? "driveNotConfigured" : "uploadFailed";
}

/* Shared validation for both save paths. Returns {error} or the clean row.

   Custom answers are validated LAST and against the event's own field list —
   never against a list sent by the client — so a guest cannot skip a required
   question by posting a different set of fields, and cannot smuggle an answer
   to a question this event doesn't ask. */
function validateReply(event, payload) {
  if (!["yes", "no"].includes(payload?.attending)) return { error: "required" };

  if (payload.attending === "no") {
    const reason = payload.declineReason;
    if (!isDeclineReason(reason)) return { error: "reasonRequired" };
    // "Another reason" IS the free-text line — an empty line answers nothing.
    if (reason === "other" && !String(payload.declineReasonNote || "").trim()) {
      return { error: "reasonRequired" };
    }
    const answers = validateAnswers(event.customFields, {
      attending: "no",
      custom: payload.custom,
    });
    if (answers.error) return { error: answers.error };

    return {
      attending: "no",
      declineReason: reason,
      declineReasonNote: reason === "other" ? payload.declineReasonNote : null,
      message: payload.message,
      custom: answers.custom,
      attendees: [],
    };
  }

  const adults = Math.max(0, Math.min(MAX_PARTY_SIZE_LIMIT, Number(payload.adults) || 0));
  const children = Math.max(0, Math.min(MAX_PARTY_SIZE_LIMIT, Number(payload.children) || 0));
  // Cap enforced server-side. The client stepper also caps, but the client is
  // not a security boundary and headcount drives catering spend.
  if (adults + children > (event.max_party_size || 10)) return { error: "partyTooBig" };
  if (adults + children < 1) return { error: "required" };

  const answers = validateAnswers(event.customFields, {
    attending: "yes",
    headCount: adults + children,
    custom: payload.custom,
    attendees: payload.attendees,
  });
  if (answers.error) return { error: answers.error };

  return {
    attending: "yes",
    adults,
    children,
    extraNames: payload.extraNames,
    message: payload.message,
    custom: answers.custom,
    attendees: answers.attendees,
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
    event.ask_contribution &&
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
  if (!event.ask_contribution) return { ok: false, error: "error" };

  const clean = validateReply(event, { ...payload, attending: "yes" });
  if (clean.error) return { ok: false, error: clean.error };

  const product = await getContributionProduct(event.support_url);
  if (!product) return { ok: false, error: "error" };

  /* Which tier the family chose. The store is the authority on what exists:
     the id is resolved against the live product, and an admin-pinned variant
     wins outright — so the checkout can only ever be for a real, purchasable
     line the event actually offers. */
  const variant = chooseVariant(
    product,
    product.pinned ? product.variantId : null,
    payload?.variantId
  );
  if (!variant) return { ok: false, error: "error" };

  saveRsvp(guest.id, event.id, clean);

  // Already paid (e.g. a second click after the webhook landed): no second
  // checkout — report the truth instead.
  if (rsvp?.contribution_status === "paid") {
    revalidatePath(`/i/${token}`);
    return { ok: true, alreadyPaid: true };
  }

  // The pending line names the CHOSEN tier, not just the product — "$50 Family
  // Sponsor" is the part Karim reconciles against, and the webhook overwrites
  // this with Shopify's own wording once the payment lands.
  markContributionPending(
    guest.id,
    variant.title && variant.title !== product.title
      ? `${product.title} — ${variant.title}`
      : product.title,
    variant.id
  );
  revalidatePath(`/i/${token}`);
  return {
    ok: true,
    variantId: String(variant.id),
    checkoutUrl: contributionCheckoutUrl({
      variantId: String(variant.id),
      token: guest.token,
      eventId: event.id,
    }),
  };
}

/* Photo upload is a SEPARATE action from the RSVP on purpose. Drive is a third
   party that can be slow or down, and an outage there must never cost us a
   reply. A failure here is reported as a photo problem, not an RSVP problem. */
/* The same pipeline as the family photo, for a custom question of type "file".

   Returns the Drive file id, which the form then submits as that question's
   answer — the guest never names the destination, and an id that didn't come
   from here can't be forged into one, because coerceAnswer only accepts the
   id-shaped string and the file itself lives in LQK's own Drive folder.

   The field id is checked against the EVENT'S list: an upload aimed at a
   question this event doesn't ask is refused rather than quietly stored. */
export async function uploadFieldFile(token, { fieldId, dataUrl }) {
  const found = getGuestByToken(token);
  if (!found) return { ok: false, error: "notFound" };
  const { guest, event } = found;
  if (event.status === "draft") return { ok: false, error: "notFound" };
  if (isEventClosed(event)) return { ok: false, error: "closed" };

  const field = (event.customFields || []).find((f) => f.id === fieldId && f.type === "file");
  if (!field) return { ok: false, error: "error" };
  if (!driveConfigured()) return { ok: false, error: photoError("field upload", { error: "driveNotConfigured" }) };

  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl || "");
  if (!match) return { ok: false, error: "badImage" };

  const [, mime, base64] = match;
  if ((base64.length * 3) / 4 > MAX_PHOTO_BYTES) return { ok: false, error: "tooLarge" };

  const result = await uploadPhoto({
    base64,
    mime,
    filename: photoFilename({
      // The question's label is in the filename so a folder of uploads is
      // sortable by what was asked, not just by who answered.
      familyName: `${field.label} — ${guest.family_name || guest.name}`,
      guestName: guest.name,
      token: guest.token,
      mime,
    }),
    eventSlug: event.slug,
  });

  if (!result.ok) return { ok: false, error: photoError(`field ${fieldId}`, result) };
  return { ok: true, fileId: result.fileId };
}
