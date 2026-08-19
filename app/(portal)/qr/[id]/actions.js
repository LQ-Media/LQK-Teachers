"use server";

import { revalidatePath } from "next/cache";
import { randomUUID } from "node:crypto";
import { requireRole } from "@/lib/dal";
import {
  getQrEvent,
  saveQrEvent,
  importExpected,
  clearExpected,
  addAsset,
  deleteAsset,
  getAsset,
  deletePhoto,
} from "@/lib/qr/queries";
import { parseFields } from "@/lib/qr/fields";
import { parseInviteeCsv } from "@/lib/qr/csv";
import { decodeDataUrl, writeTemplate, ASSET_KINDS } from "@/lib/qr/assets";

/* EVERY export re-checks the role — a server action is a public HTTP endpoint,
   and the fact that the only link to it sits behind an admin-gated page stops
   exactly nobody who reads the JS bundle. */

const DEFAULT_CONSENT =
  "I agree to Little Quran Kids using this photo to create our event picture. I understand the photo is sent to an AI image service to make it, and is not kept afterwards.";

export async function saveQrEventAction(id, form) {
  await requireRole(["admin"]);
  const event = getQrEvent(id);
  if (!event) return { ok: false, error: "That registration no longer exists." };

  const title = String(form.title || "").trim();
  if (!title) return { ok: false, error: "A name is required." };

  const status = ["draft", "open", "closed"].includes(form.status) ? form.status : "draft";
  const photoEnabled = Boolean(form.photoEnabled);

  /* Checked only when check-in is being OPENED — Karim has to be able to save
     a half-built setup and come back to it. The consent wording is the one
     thing that cannot be left blank with the photo feature on: it is what the
     parent is agreeing to, and a blank tick-box agrees to nothing. */
  if (status === "open" && photoEnabled && !String(form.photoConsentText || "").trim()) {
    return { ok: false, error: "Write the consent wording before opening an event that asks for photos." };
  }

  saveQrEvent(id, {
    title,
    venueName: form.venueName,
    startsAt: form.startsAt,
    status,
    intro: form.intro,
    fields: parseFields(form.fields || []),
    photoEnabled,
    photoPrompt: form.photoPrompt,
    photoBlurb: form.photoBlurb,
    photoConsentText: String(form.photoConsentText || "").trim() || DEFAULT_CONSENT,
  });

  revalidatePath(`/qr/${id}`);
  revalidatePath("/qr");
  return { ok: true };
}

/* The expected list.

   Parsed on the SERVER even though the studio previews the same paste in the
   browser: the preview is a courtesy, and a client that can be edited is not a
   validator. Both call the same pure parser, so what is previewed is what gets
   stored. */
export async function importExpectedAction(id, text, { replace = false } = {}) {
  await requireRole(["admin"]);
  if (!getQrEvent(id)) return { ok: false, error: "That registration no longer exists." };

  const { rows, skipped } = parseInviteeCsv(text);
  if (!rows.length) {
    return { ok: false, error: "No names found. One name per line, or a CSV with name and class columns." };
  }

  const { added, duplicates } = importExpected(id, rows, { replace });
  revalidatePath(`/qr/${id}`);
  return { ok: true, added, duplicates: duplicates + skipped };
}

export async function clearExpectedAction(id) {
  await requireRole(["admin"]);
  clearExpected(id);
  revalidatePath(`/qr/${id}`);
  return { ok: true };
}

export async function uploadAssetAction(id, { kind, label, dataUrl }) {
  await requireRole(["admin"]);
  if (!getQrEvent(id)) return { ok: false, error: "That registration no longer exists." };
  if (!ASSET_KINDS.some((k) => k.kind === kind)) return { ok: false, error: "Unknown artwork slot." };

  const decoded = decodeDataUrl(dataUrl);
  if (!decoded.ok) return decoded;

  // The filename is a generated id, never anything from the upload: a name
  // that came from a form and then got joined onto a path is how a traversal
  // happens.
  const fileId = randomUUID();
  const fileName = writeTemplate(fileId, decoded.mime, decoded.bytes);
  addAsset(id, {
    kind,
    label: String(label || "").trim().slice(0, 60) || null,
    fileName,
    mime: decoded.mime,
    bytes: decoded.bytes.length,
  });

  revalidatePath(`/qr/${id}`);
  return { ok: true };
}

export async function deleteAssetAction(id, assetId) {
  await requireRole(["admin"]);
  const asset = getAsset(assetId);
  // Scoped to the event in the URL so an id from another event can't be
  // deleted by guessing.
  if (!asset || asset.qr_event_id !== id) return { ok: false, error: "That artwork is not part of this event." };
  deleteAsset(assetId);
  revalidatePath(`/qr/${id}`);
  return { ok: true };
}

/* Karim removing a generated picture on a family's behalf — the "please take
   that down" path. Deletes the row and the file, not just the row. */
export async function deletePhotoAction(id, registrationId) {
  await requireRole(["admin"]);
  if (!getQrEvent(id)) return { ok: false, error: "That registration no longer exists." };
  deletePhoto(registrationId);
  revalidatePath(`/qr/${id}`);
  return { ok: true };
}
