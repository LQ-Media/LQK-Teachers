"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import {
  getQrEvent,
  saveQrConfig,
  replaceBooths,
  importInvitees,
  clearInvitees,
} from "@/lib/qr/queries";
import { parseTiers, wordLetters } from "@/lib/qr/passport";
import { parseInviteeCsv } from "@/lib/qr/csv";

export async function saveQrSetupAction(id, form) {
  await requireRole(["admin"]);
  const event = getQrEvent(id);
  if (!event) return { ok: false, error: "That registration no longer exists." };

  const title = String(form.title || "").trim();
  if (!title) return { ok: false, error: "A name is required." };

  const booths = Array.isArray(form.booths)
    ? form.booths.map((b) => String(b || "").trim()).filter(Boolean)
    : [];
  const word = String(form.word || "").trim();
  const letters = wordLetters(word);
  const tiers = parseTiers(JSON.stringify(form.tiers || []));
  const status = ["draft", "open", "closed"].includes(form.status) ? form.status : "draft";

  /* The invariant that is otherwise only discovered on the day: one booth short
     and the word can never complete, so nobody reaches the top tier; one too
     many and a booth hands out nothing. Checked only when check-in is being
     OPENED — Karim has to be able to save a half-built setup and come back. */
  if (status === "open") {
    if (!booths.length) return { ok: false, error: "Add at least one booth before opening check-in." };
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
      return { ok: false, error: "Set a staff PIN of 4–8 digits before opening check-in." };
    }
    const overshoot = tiers.find((tier) => tier.at > booths.length);
    if (overshoot) {
      return {
        ok: false,
        error: `“${overshoot.label}” needs ${overshoot.at} booths, but there are only ${booths.length}. No family could ever claim it.`,
      };
    }
  }

  replaceBooths(id, booths);
  saveQrConfig(id, {
    title,
    venueName: String(form.venueName || "").trim() || null,
    status,
    word: letters.join(""),
    pin: String(form.pin || "").trim() || null,
    tiers,
    intro: String(form.intro || "").trim() || null,
    classes: Array.isArray(form.classes)
      ? form.classes.map((c) => String(c || "").trim()).filter(Boolean).slice(0, 40)
      : [],
  });

  revalidatePath(`/qr/${id}`);
  revalidatePath("/qr");
  return { ok: true };
}

/* The expected-guest list.

   Parsed on the SERVER even though the studio previews the same paste in the
   browser: the preview is a courtesy, and a client that can be edited is not
   a validator. Both call the same pure parser, so what is previewed is what
   gets stored. */
export async function importInviteesAction(id, text, { replace = false } = {}) {
  await requireRole(["admin"]);
  const event = getQrEvent(id);
  if (!event) return { ok: false, error: "That registration no longer exists." };

  const { rows, skipped } = parseInviteeCsv(text);
  if (!rows.length) {
    return { ok: false, error: "No names found. One name per line, or a CSV with a “name” column." };
  }

  const { added, duplicates } = importInvitees(id, rows, { replace });
  revalidatePath(`/qr/${id}`);
  return { ok: true, added, duplicates: duplicates + skipped };
}

export async function clearInviteesAction(id) {
  await requireRole(["admin"]);
  clearInvitees(id);
  revalidatePath(`/qr/${id}`);
  return { ok: true };
}
