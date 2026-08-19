"use server";

import { revalidatePath } from "next/cache";
import { requireRole } from "@/lib/dal";
import { createQrEvent, deleteQrEvent } from "@/lib/qr/queries";

/* EVERY export re-checks the role — a server action is a public HTTP endpoint,
   and the fact that the only link to it sits behind an admin-gated page stops
   exactly nobody who reads the JS bundle. */

export async function createQrEventAction(form) {
  const session = await requireRole(["admin"]);
  const title = String(form.title || "").trim();
  if (!title) return { ok: false, error: "A name is required." };

  const event = createQrEvent({
    title,
    venueName: String(form.venueName || "").trim() || null,
    startsAt: String(form.startsAt || "").trim() || null,
    createdBy: session.userId,
  });
  revalidatePath("/qr");
  return { ok: true, id: event.id };
}

export async function deleteQrEventAction(id) {
  await requireRole(["admin"]);
  deleteQrEvent(id);
  revalidatePath("/qr");
  return { ok: true };
}
