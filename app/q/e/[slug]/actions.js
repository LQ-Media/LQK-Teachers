"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getOpenQrEvent, checkIn, searchExpected, clampPax } from "@/lib/qr/queries";
import { normalizePhone } from "@/lib/events/phone";
import { validateAnswers } from "@/lib/qr/fields";
import { PASS_COOKIE } from "@/lib/qr/tokens";

/* Check-in is a PUBLIC action — the whole point is that a parent with no
   account can use it — so it re-reads the event itself and refuses anything
   that isn't open. `getOpenQrEvent` returns nothing for a draft or a closed
   event, which is the gate. */

const MAX_PEOPLE = 20;

/* The door's type-ahead.

   A server action rather than shipping the list to the browser: the whole list
   in the bundle IS the list published, whatever the UI chooses to render — and
   this one carries children's names and classes. The two-character minimum
   lives in searchExpected. */
export async function searchExpectedAction(slug, query) {
  const event = getOpenQrEvent(slug);
  if (!event) return [];
  return searchExpected(event.id, query);
}

export async function checkInAction(slug, form) {
  const event = getOpenQrEvent(slug);
  if (!event) return { ok: false, error: "Check-in for this event isn’t open." };

  const familyName = String(form.familyName || "").trim().slice(0, 60);
  if (!familyName) return { ok: false, error: "Please add your family name." };

  const people = (Array.isArray(form.people) ? form.people : [])
    .map((person) => ({
      expectedId: String(person?.expectedId || "").trim() || null,
      name: String(person?.name || "").trim().slice(0, 60),
      className: String(person?.className || "").trim().slice(0, 40) || null,
      kind: person?.kind === "adult" ? "adult" : "child",
    }))
    .filter((person) => person.name)
    .slice(0, MAX_PEOPLE);

  // Attendance is the whole point — a registration with nobody in it records
  // that a family arrived without recording that anyone did.
  if (!people.length) return { ok: false, error: "Add at least one person who is here." };

  let phone = null;
  const rawPhone = String(form.phone || "").trim();
  if (rawPhone) {
    phone = normalizePhone(rawPhone);
    // normalizePhone accepts SG landlines (leading 6) because the guest
    // importer legitimately holds them. SG mobiles start 8 or 9; this caller
    // narrows it rather than changing the shared helper.
    if (phone && phone.startsWith("+65") && !/^\+65[89]/.test(phone)) phone = null;
    if (!phone) return { ok: false, error: "That doesn’t look like a mobile number." };
  }

  const email = String(form.email || "").trim().slice(0, 120);
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return { ok: false, error: "That doesn’t look like an email address." };
  }

  const checked = validateAnswers(event.fields, form.answers);
  if (!checked.ok) return checked;

  const created = checkIn(event.id, {
    familyName,
    // Ignored unless the event asks — a number posted at an event that never
    // offered the question is not an answer, it is somebody editing the page.
    extraPax: event.ask_pax ? clampPax(form.extraPax) : 0,
    contactName: String(form.contactName || "").trim().slice(0, 60) || null,
    phone,
    email: email || null,
    answers: checked.answers,
    people,
  });

  // Two phones checked the same student in within a second of each other.
  if (created.taken) {
    return { ok: false, error: "Someone was just checked in under that name. Please pick the name again." };
  }

  /* Remember the pass on this phone. Re-scanning the door QR is the single most
     common accident of the day — a parent shows the code to a friend, or scans
     it again on the way past — and without this each one silently creates a
     second registration and double-counts the family. */
  const cookieStore = await cookies();
  cookieStore.set(`${PASS_COOKIE}_${event.id}`, created.token, {
    httpOnly: false, // read on the client so the door page can offer the pass back
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });

  // redirect() SIGNALS BY THROWING — it must be the last thing here and must
  // never be wrapped in a try that would swallow it.
  redirect(`/q/p/${created.token}`);
}
