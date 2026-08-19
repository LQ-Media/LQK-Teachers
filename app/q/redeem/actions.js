"use server";

import {
  getQrEvent,
  getFamilyByToken,
  passportFor,
  claimTier,
} from "@/lib/qr/queries";
import { getBoothSession } from "@/lib/qr/booth-session";
import { parseToken, displayName } from "@/lib/qr/passport";

/* The prize counter. Same signed booth session as the scanner — one PIN, typed
   once per phone, covers both screens. */

async function requireDesk() {
  const session = await getBoothSession();
  if (!session) return { error: "Please enter the staff PIN again." };
  const event = getQrEvent(session.eventId);
  if (!event || event.status === "draft") return { error: "That registration isn’t live." };
  return { event };
}

export async function lookupFamilyAction(scanned) {
  const { event, error } = await requireDesk();
  if (error) return { ok: false, error };

  const token = parseToken(scanned);
  if (!token) return { ok: false, error: "That isn’t a pass code." };

  const found = getFamilyByToken(token);
  if (!found || found.family.qr_event_id !== event.id) {
    return { ok: false, error: "That pass belongs to a different event." };
  }

  const passport = passportFor(event, found.family);
  return {
    ok: true,
    familyToken: found.family.token,
    name: displayName(found.family),
    collected: passport.collected,
    total: passport.total,
    tiers: passport.tiers,
  };
}

/* Hands a prize over.

   claimTier re-checks the threshold SERVER-SIDE. The button is hidden when a
   tier is locked, but a server action is a public HTTP endpoint reachable by
   direct POST, and a prize given early is a real cost that cannot be taken
   back. The hidden button is a courtesy; this is the rule. */
export async function claimTierAction(scanned, tierIndex) {
  const { event, error } = await requireDesk();
  if (error) return { ok: false, error };

  const token = parseToken(scanned);
  const found = token ? getFamilyByToken(token) : null;
  if (!found || found.family.qr_event_id !== event.id) {
    return { ok: false, error: "That pass belongs to a different event." };
  }

  const result = claimTier(event, found.family, Number(tierIndex));
  if (!result.ok) return result;

  const passport = passportFor(event, found.family);
  return {
    ok: true,
    already: result.already,
    label: result.tier.label,
    name: displayName(found.family),
    tiers: passport.tiers,
    collected: passport.collected,
    total: passport.total,
    familyToken: found.family.token,
  };
}
