/* Singapore-first E.164 normalisation.

   Lives in its own client-safe module because three callers need it and they
   don't all run on the server: the guest importer (server), the custom-field
   validator (both), and the reply form's live feedback (client). queries.js
   re-exports it so existing `from "@/lib/events/queries"` imports still work.

   Wati rejects anything that isn't E.164, and a silently-malformed number fails
   at send time — after Karim thinks the list is clean — so numbers are
   normalised at entry and stored canonical. Returns null for anything unusable
   rather than guessing. */
export function normalizePhone(input, defaultCountry = "65") {
  if (!input) return null;
  let digits = String(input).replace(/[^\d+]/g, "");
  if (digits.startsWith("+")) digits = digits.slice(1);
  digits = digits.replace(/\D/g, "");
  if (!digits) return null;
  if (digits.startsWith("00")) digits = digits.slice(2);
  // Bare 8-digit SG mobile/landline
  if (digits.length === 8 && /^[3689]/.test(digits)) digits = defaultCountry + digits;
  if (digits.length < 8 || digits.length > 15) return null;
  return `+${digits}`;
}
