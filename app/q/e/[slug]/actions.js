"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getPublicQrEvent, registerFamily } from "@/lib/events/passport-queries";
import { normalizePhone } from "@/lib/events/phone";
import { PASS_COOKIE } from "@/lib/events/passport";

/* Registration is a PUBLIC action — the whole point is that a parent with no
   account can use it — so it re-reads the event itself and refuses anything
   that isn't open. `getPublicQrEvent` returns nothing for an event whose
   check-in is closed, which is the gate. */

const MAX_CHILDREN = 12;

export async function registerFamilyAction(slug, form) {
  const event = getPublicQrEvent(slug);
  if (!event) return { ok: false, error: "Check-in for this event isn’t open." };

  const surname = String(form.surname || "").trim().slice(0, 60);
  if (!surname) return { ok: false, error: "Please add your family name." };

  const children = (Array.isArray(form.children) ? form.children : [])
    .map((child) => ({
      name: String(child?.name || "").trim().slice(0, 60),
      className: String(child?.className || "").trim().slice(0, 40) || null,
    }))
    .filter((child) => child.name)
    .slice(0, MAX_CHILDREN);

  /* A landline can't receive the "here's your pass again" message and a parent
     who typed one would never know. Rejected at the door, where it can still be
     fixed, rather than discovered afterwards. */
  let phone = null;
  const rawPhone = String(form.phone || "").trim();
  if (rawPhone) {
    phone = normalizePhone(rawPhone);
    // normalizePhone accepts SG landlines (leading 6) because the guest
    // importer legitimately holds them. A pass can only be re-sent to a
    // mobile, so this caller narrows it rather than changing the shared helper.
    // SG mobiles start 8 or 9; 6 is a landline and 3 is VoIP.
    if (phone && phone.startsWith("+65") && !/^\+65[89]/.test(phone)) phone = null;
    if (!phone) return { ok: false, error: "That doesn’t look like a mobile number." };
  }

  const { token } = registerFamily(event.id, {
    surname,
    nickname: String(form.nickname || "").trim().slice(0, 60) || null,
    parentName: String(form.parentName || "").trim().slice(0, 60) || null,
    phone,
    adults: Math.min(20, Math.max(1, Number(form.adults) || 1)),
    children,
  });

  /* Remember the pass on this phone. Re-scanning the door QR is the single most
     common accident of the day — a parent shows the code to a friend, or scans
     it again on the way past — and without this each one silently creates a
     second family with a second empty pass. */
  const cookieStore = await cookies();
  cookieStore.set(`${PASS_COOKIE}_${event.id}`, token, {
    httpOnly: false, // read on the client so the door page can offer the pass back
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24,
  });

  // redirect() SIGNALS BY THROWING — it must be the last thing here and must
  // never be wrapped in a try that would swallow it.
  redirect(`/q/p/${token}`);
}
