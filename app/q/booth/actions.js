"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/session";
import {
  getQrEvent,
  pinMatches,
  awardBooth,
  getFamilyByToken,
  passportFor,
} from "@/lib/qr/queries";
import { createBoothSession, getBoothSession, clearBoothSession } from "@/lib/qr/booth-session";
import { parseToken, displayName } from "@/lib/qr/passport";

/* Event-day actions for the booth phone and the prize counter.

   These are PUBLIC endpoints — a volunteer has no portal account — so every one
   of them re-derives the booth session from the signed cookie rather than
   trusting an event id sent by the client. */

export async function signInBoothAction(eventId, pin) {
  const event = getQrEvent(eventId);
  if (!event || event.status !== "open") return { ok: false, error: "That event isn’t open." };

  /* A signed-in admin skips the PIN. They are already more trusted than the
     PIN makes anyone, and on the day it is always Karim who picks a phone up to
     check whether the thing is working. The PIN stays for everyone else. */
  const session = await getSession();
  const isStaff = session?.role === "admin";

  if (!isStaff && !pinMatches(event, pin)) {
    return { ok: false, error: "That PIN isn’t right." };
  }

  await createBoothSession({ eventId: event.id });
  return { ok: true };
}

export async function pickBoothAction(boothId) {
  const session = await getBoothSession();
  if (!session) return { ok: false, error: "Please enter the staff PIN again." };
  const event = getQrEvent(session.eventId);
  if (!event) return { ok: false, error: "That event no longer exists." };
  const booth = event.booths.find((b) => b.id === boothId);
  if (!booth) return { ok: false, error: "That booth isn’t part of this event." };

  await createBoothSession({ eventId: event.id, boothId: booth.id });
  revalidatePath("/q/booth");
  return { ok: true };
}

/* "Change" on the scanner means "I'm moving to a different booth", not "sign
   this phone out". Re-issuing the session without a booth keeps the PIN
   entered — a volunteer swapping stations mid-event should not have to find
   whoever knows the number. Full sign-out stays available on the picker. */
export async function changeBoothAction() {
  const session = await getBoothSession();
  if (!session) return { ok: false, error: "Please enter the staff PIN again." };
  await createBoothSession({ eventId: session.eventId, boothId: null });
  revalidatePath("/q/booth");
  return { ok: true };
}

export async function signOutBoothAction() {
  await clearBoothSession();
  revalidatePath("/q/booth");
  return { ok: true };
}

/* The one write that matters on the day.

   `scanned` is whatever the camera or the manual field produced — a full pass
   URL or a bare code. parseToken sorts that out; this refuses anything it
   can't resolve rather than guessing at a near-miss, because awarding the
   wrong family is worse than asking them to try again. */
export async function awardAction(scanned) {
  const session = await getBoothSession();
  if (!session?.boothId) return { ok: false, error: "Pick your booth first." };

  const event = getQrEvent(session.eventId);
  if (!event || event.status !== "open") return { ok: false, error: "Check-in for this event is closed." };

  const token = parseToken(scanned);
  if (!token) return { ok: false, error: "That isn’t a pass code. Try again, or type the 8 characters." };

  const found = getFamilyByToken(token);
  // A pass from ANOTHER event scans perfectly and must not award here — two LQK
  // events in one month is normal, and a parent may still have the old tab open.
  if (!found || found.family.qr_event_id !== event.id) {
    return { ok: false, error: "That pass belongs to a different event." };
  }

  const booth = event.booths.find((b) => b.id === session.boothId);
  if (!booth) return { ok: false, error: "Your booth was removed. Pick another." };

  const result = awardBooth(event.id, found.family.id, booth.id);
  if (!result.ok) return result;

  const passport = passportFor(event, found.family);
  return {
    ok: true,
    already: result.already,
    name: displayName(found.family),
    letter: booth.letter,
    booth: booth.name,
    collected: passport.collected,
    total: passport.total,
    complete: passport.complete,
  };
}
