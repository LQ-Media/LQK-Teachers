"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { getQrEvent, saveQrConfig, replaceBooths } from "@/lib/events/passport-queries";
import { parseTiers, wordLetters } from "@/lib/events/passport";

/* Admin actions for QR Registration. EVERY export re-checks the role — a server
   action is a public HTTP endpoint, and the fact that the only link to it sits
   behind an admin-gated page stops exactly nobody who reads the JS bundle. */

export async function saveQrSetupAction(eventId, form) {
  await requireRole(["admin"]);
  const event = getQrEvent(eventId);
  if (!event) return { ok: false, error: "That event no longer exists." };

  const booths = Array.isArray(form.booths)
    ? form.booths.map((b) => String(b || "").trim()).filter(Boolean)
    : [];
  const word = String(form.word || "").trim();
  const letters = wordLetters(word);
  const tiers = parseTiers(JSON.stringify(form.tiers || []));

  /* The invariant that is otherwise only discovered on the day: one booth short
     and the word can never complete, so nobody reaches the top tier; one too
     many and a booth hands out nothing. Refused at the door rather than warned
     about, but ONLY when the feature is being switched on — Karim has to be
     able to save a half-built setup and come back to it. */
  if (form.enabled) {
    if (!booths.length) return { ok: false, error: "Add at least one booth before going live." };
    if (!letters.length) return { ok: false, error: "Choose a word for the booths to spell." };
    if (letters.length !== booths.length) {
      return {
        ok: false,
        error: `“${word}” has ${letters.length} letter${letters.length === 1 ? "" : "s"} but there ${
          booths.length === 1 ? "is 1 booth" : `are ${booths.length} booths`
        }. They must match.`,
      };
    }
    if (!/^\d{4,8}$/.test(String(form.pin || ""))) {
      return { ok: false, error: "Set a staff PIN of 4–8 digits before going live." };
    }
    const overshoot = tiers.find((tier) => tier.at > booths.length);
    if (overshoot) {
      return {
        ok: false,
        error: `“${overshoot.label}” needs ${overshoot.at} booths, but there are only ${booths.length}. No family could ever claim it.`,
      };
    }
  }

  replaceBooths(eventId, booths);
  saveQrConfig(eventId, {
    enabled: !!form.enabled,
    word: letters.join(""),
    pin: String(form.pin || "").trim() || null,
    tiers,
    intro: String(form.intro || "").trim() || null,
    classes: Array.isArray(form.classes)
      ? form.classes.map((c) => String(c || "").trim()).filter(Boolean).slice(0, 40)
      : [],
  });

  revalidatePath(`/events/${eventId}/qr`);
  revalidatePath(`/events/${eventId}`);
  return { ok: true };
}
